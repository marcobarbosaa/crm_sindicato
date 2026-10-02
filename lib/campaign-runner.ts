import { SendFailure, databaseFailure, runtimeFailure } from "@/lib/send-diagnostics";
﻿import { dailyCampaignUsage } from "@/lib/campaign-quota";
import { sendingDayWindow } from "@/lib/settings";
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb, withCampaignDb } from "@/db";
import { activityLogs, campaignOwnerLeases, crmSettings, emailAccounts, emailCampaignRecipients, emailCampaigns, emailMessages, emailTemplates } from "@/db/schema";
import { loadSendAttachments } from "@/lib/attachment-service";
import { syncCampaignCounters } from "@/lib/campaign-counters";
import { GmailOAuthError, decryptToken, encodeRawEmail, refreshAccessToken } from "@/lib/gmail";
import { CHUNK_DEADLINE_MS, INFRASTRUCTURE_NOTICE, MAX_ATTEMPTS, TECHNICAL_CHUNK_SIZE, UNCERTAIN_NOTICE, classifyGmailFailure, classifyRuntimeFailure, isSubrequestLimit, providerRecipientStatus, staleDisposition } from "@/lib/campaign-policy";

const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const LOCK_MS = 5 * 60_000;
const STALE_PROCESSING_MS = 10 * 60_000;
const personalize = (value: string, data: Record<string, string>) => value.replace(/{{\s*(empresa|contato|segmento|cidade|estado|email_empresa)\s*}}/g, (_, key: string) => data[key] || "");
type Recipient = typeof emailCampaignRecipients.$inferSelect;
type Campaign = typeof emailCampaigns.$inferSelect;

async function getCampaignControlState(campaignId: number) {
  const [campaign] = await getDb().select({ status: emailCampaigns.status }).from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)).limit(1);
  return campaign?.status;
}

// A bounded maintenance-only invocation. A PREPARED message proves no Gmail
// request could start. Legacy QUEUED and SENDING messages never auto-retry.
export async function reconcileStaleRecipients(campaignId: number) {
  const db = getDb(), cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const stale = await db.select({ target: emailCampaignRecipients, message: emailMessages })
    .from(emailCampaignRecipients).leftJoin(emailMessages, eq(emailCampaignRecipients.messageId, emailMessages.id))
    .where(and(eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.status, "PROCESSING"),
      lte(emailCampaignRecipients.processingStartedAt, cutoff))).orderBy(asc(emailCampaignRecipients.id)).limit(TECHNICAL_CHUNK_SIZE);
  for (const { target, message } of stale) {
    const status = staleDisposition(message?.status);
    await db.update(emailCampaignRecipients).set({ status, processingStartedAt: null,
      messageId: status === "PENDING" ? null : target.messageId,
      providerMessageId: message?.providerMessageId || null,
      sentAt: status === "SENT" ? message?.sentAt || new Date() : target.sentAt,
      failureCategory: status === "UNCERTAIN" ? "UNCERTAIN_DELIVERY" : status === "PENDING" ? "INFRASTRUCTURE_FAILURE" : target.failureCategory,
      errorMessage: status === "UNCERTAIN" ? UNCERTAIN_NOTICE : status === "PENDING" ? INFRASTRUCTURE_NOTICE : message?.errorMessage || null,
      updatedAt: new Date(),
    }).where(and(eq(emailCampaignRecipients.id, target.id), eq(emailCampaignRecipients.status, "PROCESSING"), eq(emailCampaignRecipients.processingStartedAt, target.processingStartedAt!)));
  }
  return { checked: stale.length };
}

function staleCampaignCondition() {
  return sql`exists (select 1 from ${emailCampaignRecipients} where ${emailCampaignRecipients.campaignId} = ${emailCampaigns.id}
    and ${emailCampaignRecipients.status} = 'PROCESSING' and ${emailCampaignRecipients.processingStartedAt} <= ${Date.now() - STALE_PROCESSING_MS})`;
}

export async function claimCampaign(ownerId: string, campaignId: number) {
  const db = getDb(), now = new Date(), lockUntil = new Date(now.getTime() + LOCK_MS), token = crypto.randomUUID();
  return db.transaction(async tx => {
    // Serialize campaign sends for the same owner, including cron/HTTP overlap.
    const [lease] = await tx.insert(campaignOwnerLeases).values({ ownerId, token, expiresAt: lockUntil })
      .onConflictDoUpdate({ target: campaignOwnerLeases.ownerId, set: { token, expiresAt: lockUntil }, setWhere: lte(campaignOwnerLeases.expiresAt, now) }).returning();
    if (!lease) return null;
    const [campaign] = await tx.update(emailCampaigns).set({ lockUntil, updatedAt: now }).where(and(
      eq(emailCampaigns.id, campaignId), eq(emailCampaigns.ownerId, ownerId),
      or(and(eq(emailCampaigns.status, "RUNNING"), or(isNull(emailCampaigns.nextRunAt), lte(emailCampaigns.nextRunAt, now))), staleCampaignCondition()),
      or(isNull(emailCampaigns.lockUntil), lte(emailCampaigns.lockUntil, now)),
    )).returning();
    if (!campaign) { await tx.delete(campaignOwnerLeases).where(and(eq(campaignOwnerLeases.ownerId, ownerId), eq(campaignOwnerLeases.token, token))); return null; }
    return { campaign, token };
  });
}

export async function getCampaignBatch(ownerId: string, campaignId: number, snapshot?: Campaign) {
  const db = getDb();
  const campaign = snapshot || (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.ownerId, ownerId))).limit(1))[0];
  if (!campaign) throw new Error("Campanha não encontrada.");
  const [settings] = await db.select().from(crmSettings).where(eq(crmSettings.ownerId, ownerId)).limit(1);
  const { start, next } = sendingDayWindow(settings?.timezone);
  // Unresolved sends reserve capacity too; a lost Gmail response cannot free quota.
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(emailMessages).where(dailyCampaignUsage(ownerId, start, next));
  const remaining = Math.max(0, (settings?.dailySendLimit || 100) - Number(total || 0));
  let logicalBatch = campaign.logicalBatch;
  if (!logicalBatch && remaining > 0) {
    const members = await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.status, "PENDING")))
      .orderBy(asc(emailCampaignRecipients.id)).limit(campaign.batchSize);
    if (members.length) {
      logicalBatch = { id: crypto.randomUUID(), recipientIds: members.map(row => row.id), startedAt: Date.now() };
      await db.update(emailCampaigns).set({ logicalBatch }).where(eq(emailCampaigns.id, campaignId));
    }
  }
  const recipients = logicalBatch && remaining > 0 ? await db.select().from(emailCampaignRecipients).where(and(
    eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.id, logicalBatch.recipientIds), eq(emailCampaignRecipients.status, "PENDING"),
    or(isNull(emailCampaignRecipients.lastBatchId), ne(emailCampaignRecipients.lastBatchId, logicalBatch.id)),
  )).orderBy(asc(emailCampaignRecipients.id)).limit(Math.min(TECHNICAL_CHUNK_SIZE, remaining)) : [];
  return { campaign, settings, remaining, recipients, logicalBatch, nextDailyWindow: next };
}

async function finishChunk(campaign: Campaign, logicalBatch: Campaign["logicalBatch"], dailyWindow?: Date) {
  const db = getDb(), campaignId = campaign.id;
  const counters = await syncCampaignCounters(campaignId);
  const status = await getCampaignControlState(campaignId);
  const unresolved = counters.processing + counters.uncertain;
  const completed = status === "RUNNING" && counters.pending === 0;
  const needsReview = counters.uncertain > 0;
  const outstanding = logicalBatch ? await db.select({ id: emailCampaignRecipients.id }).from(emailCampaignRecipients).where(and(
    inArray(emailCampaignRecipients.id, logicalBatch.recipientIds), eq(emailCampaignRecipients.status, "PENDING"),
    or(isNull(emailCampaignRecipients.lastBatchId), ne(emailCampaignRecipients.lastBatchId, logicalBatch.id)),
  )).limit(1) : [];
  const batchDone = Boolean(logicalBatch) && !outstanding.length && counters.processing === 0;
  const now = new Date();
  // The business interval starts only when ALL logical batch members have had an
  // outcome. Retryable provider failures participate once per logical batch.
  const nextRunAt = completed || (needsReview && !batchDone) ? null : dailyWindow || new Date(now.getTime() + (batchDone ? campaign.intervalMinutes * 60_000 : 0));
  if (status === "RUNNING") await db.update(emailCampaigns).set({ status: needsReview ? "PAUSED" : completed ? "COMPLETED" : "RUNNING",
    logicalBatch: batchDone ? null : logicalBatch, nextRunAt, completedAt: completed ? now : null, updatedAt: now,
  }).where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.status, "RUNNING"), eq(emailCampaigns.lockUntil, campaign.lockUntil!)));
  return { campaignId, completed, paused: status === "PAUSED" || needsReview, cancelled: status === "CANCELLED", needsReview, unresolved,
    waitingDailyLimit: Boolean(dailyWindow), locked: false, nextRunAt: status === "RUNNING" ? nextRunAt : null, counters, batchCompleted: batchDone };
}

export async function processCampaignBatch(ownerId: string, campaignId: number) {
  return withCampaignDb(() => processChunk(ownerId, campaignId));
}

async function processChunk(ownerId: string, campaignId: number) {
  const db = getDb(), claim = await claimCampaign(ownerId, campaignId);
  if (!claim) return { campaignId, processed: 0, completed: false, paused: false, locked: true };
  const { campaign, token } = claim, chunkId = crypto.randomUUID(), deadline = Date.now() + CHUNK_DEADLINE_MS;
  let logicalBatch = campaign.logicalBatch, sent = 0, failed = 0, skipped = 0, retried = 0, deferred = 0;
  let stage = "reconcile";
  let deferredReason:{stage:string;category:string;causeCategory:string;errorCode:string}|undefined;
  let oauthAccount:typeof emailAccounts.$inferSelect|undefined;
  const finalize = (dailyWindow?: Date) => {
    stage = "finalize";
    return finishChunk(campaign, logicalBatch, dailyWindow);
  };
  try {
    const recovery = await reconcileStaleRecipients(campaignId);
    stage = "control";
    // Recovery and sending never consume the same invocation's I/O budget.
    if (recovery.checked || await getCampaignControlState(campaignId) !== "RUNNING") return { processed: 0, recovered: recovery.checked, ...await finalize() };
    stage = "check-unresolved";
    const [{ processing }] = await db.select({ processing: sql<number>`count(*)` }).from(emailCampaignRecipients)
      .where(and(eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.status, ["PROCESSING", "UNCERTAIN"])));
    if (Number(processing)) return { processed: 0, ...await finalize() };
    stage = "load-batch";
    const batch = await getCampaignBatch(ownerId, campaignId, campaign);
    logicalBatch = batch.logicalBatch;
    if (!batch.remaining || !batch.recipients.length) return { processed: 0, ...await finalize(!batch.remaining ? batch.nextDailyWindow : undefined) };
    stage = "gmail-account";
    const [account] = await db.select().from(emailAccounts).where(and(eq(emailAccounts.ownerId, ownerId), eq(emailAccounts.provider, "GMAIL"))).limit(1);
    if (!account || !account.scopes.split(/\s+/).includes(SEND_SCOPE)) throw new Error("Gmail indisponível.");
    stage = "template";
    const [template] = await db.select().from(emailTemplates).where(and(eq(emailTemplates.id, Number(campaign.templateId)), eq(emailTemplates.ownerId, ownerId))).limit(1);
    if (!template) throw new Error("Template indisponível.");
    stage = "attachments";
    const attachments = await loadSendAttachments(ownerId, undefined, template.id);
    const metadata = attachments.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size }));
    oauthAccount = account;
    stage = "oauth-decrypt";
    if (account.needsReconnect) throw new GmailOAuthError(0, "invalid_grant");
    const refreshToken = await decryptToken(account.encryptedRefreshToken);
    stage = "oauth-refresh";
    const accessToken = await refreshAccessToken(refreshToken);
    const from = batch.settings?.senderName ? `${batch.settings.senderName.replace(/[\r\n<>]/g, " ").trim()} <${account.email}>` : account.email;
    stage = "prepare-chunk";
    await db.update(emailCampaigns).set({ processingNotice: null }).where(eq(emailCampaigns.id, campaignId));
    for (const target of batch.recipients) {
      let messageId: number | undefined, claimedTarget: Recipient | undefined, sendStarted = false, stage = "control";
      try {
        if (Date.now() >= deadline || Date.now() >= campaign.lockUntil!.getTime()) break;
        if (await getCampaignControlState(campaignId) !== "RUNNING") break;
        const data = target.personalization || {}, subject = personalize(template.subject, data), messageBody = personalize(template.body, data);
        const body = batch.settings?.signature ? `${messageBody}\n\n${batch.settings.signature}` : messageBody;
        stage = "encode";
        const raw = encodeRawEmail({ from, to: target.recipient, subject, body, attachments });
        stage = "duplicate";
        const [duplicate] = await db.select({ id: emailMessages.id }).from(emailMessages).where(and(eq(emailMessages.ownerId, ownerId), eq(emailMessages.recipient, target.recipient),
          eq(emailMessages.subject, subject), eq(emailMessages.status, "SENT"), gte(emailMessages.createdAt, sql`${Date.now() - 24 * 60 * 60_000}`))).limit(1);
        if (duplicate) {
          await db.update(emailCampaignRecipients).set({ status: "SKIPPED", lastBatchId: logicalBatch!.id, processingStartedAt: null, errorMessage: "E-mail igual enviado nas últimas 24 horas.", updatedAt: new Date() })
            .where(and(eq(emailCampaignRecipients.id, target.id), eq(emailCampaignRecipients.status, "PENDING")));
          skipped++; continue;
        }
        stage = "prepare";
        // Atomic claim + link: no orphan QUEUED message or recipient without the
        // durable message pointer can ever have started a Gmail request.
        const prepared = await db.transaction(async tx => {
          const [recipient] = await tx.update(emailCampaignRecipients).set({ status: "PROCESSING", processingStartedAt: new Date(), errorMessage: null, failureCategory: null, updatedAt: new Date() })
            .where(and(eq(emailCampaignRecipients.id, target.id), eq(emailCampaignRecipients.status, "PENDING"))).returning();
          if (!recipient) return null;
          const [message] = await tx.insert(emailMessages).values({ ownerId, companyId: target.companyId, contactId: target.contactId, templateId: template.id, campaignId,
            recipient: target.recipient, subject, body, attachments: metadata, status: "PREPARED", kind: "BATCH", createdAt: new Date() }).returning();
          await tx.update(emailCampaignRecipients).set({ messageId: message.id }).where(eq(emailCampaignRecipients.id, target.id));
          return { recipient, message };
        });
        if (!prepared) continue;
        claimedTarget = prepared.recipient; messageId = prepared.message.id;
        stage = "send-barrier";
        if (Date.now() >= deadline) {
          await db.update(emailCampaignRecipients).set({ status: "PENDING", messageId: null, processingStartedAt: null, updatedAt: new Date() }).where(eq(emailCampaignRecipients.id, target.id));
          break;
        }
        // Persist the barrier before fetch; only a started fetch can be ambiguous.
        const armed = await db.transaction(async tx => {
          // Fold the final pause/cancel check into the durable send barrier.
          const [message] = await tx.update(emailMessages).set({ status: "SENDING" }).where(and(eq(emailMessages.id, messageId!),
            sql`exists (select 1 from ${emailCampaigns} where ${emailCampaigns.id} = ${campaignId}
              and ${emailCampaigns.status} = 'RUNNING' and ${emailCampaigns.lockUntil} = ${campaign.lockUntil!.getTime()})`,
          )).returning({ id: emailMessages.id });
          if (!message) return false;
          await tx.update(emailCampaignRecipients).set({ attempts: claimedTarget!.attempts + 1 }).where(eq(emailCampaignRecipients.id, target.id));
          return true;
        });
        if (!armed) {
          await db.update(emailCampaignRecipients).set({ status: "PENDING", messageId: null, processingStartedAt: null, updatedAt: new Date() })
            .where(and(eq(emailCampaignRecipients.id, target.id), eq(emailCampaignRecipients.status, "PROCESSING")));
          break;
        }
        if (Date.now() >= deadline) throw new Error("Send deferred before fetch");
        sendStarted = true;
        stage = "gmail-fetch";
        const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", redirect: "manual",
          headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ raw }), signal: AbortSignal.timeout(30_000) });
        // A confirmed non-2xx is a provider rejection, even with a non-JSON body.
        const result = await response.json().catch(() => null) as { id?: string; error?: { message?: string; errors?: { reason?: string }[] } } | null;
        if (!response.ok) {
          stage = "provider-rejection";
          const category = classifyGmailFailure(response.status, (result?.error?.message || "") + " " + (result?.error?.errors?.map(e => e.reason).join(" ") || ""));
          const attempts = claimedTarget.attempts + 1, status = providerRecipientStatus(category, attempts);
          const reason = status === "PENDING" ? `Gmail temporariamente indisponível (HTTP ${response.status}). Tentativa ${attempts}/${MAX_ATTEMPTS}; será tentado novamente.` : `Gmail rejeitou o envio (HTTP ${response.status}); tentativas: ${attempts}/${MAX_ATTEMPTS}.`;
          await db.transaction(async tx => {
            await tx.update(emailMessages).set({ status: status === "PENDING" ? "RETRYABLE" : "FAILED", errorMessage: reason }).where(eq(emailMessages.id, messageId!));
            await tx.update(emailCampaignRecipients).set({ status, lastBatchId: logicalBatch!.id, failureCategory: category, processingStartedAt: null,
              messageId: status === "PENDING" ? null : messageId, errorMessage: reason, updatedAt: new Date() }).where(eq(emailCampaignRecipients.id, target.id));
          });
          console.info({ event: "campaign.recipient", campaignId, recipientId: target.id, batchId: logicalBatch!.id, chunkId, attempt: attempts, stage, category });
          if (status === "PENDING") retried++; else failed++;
          continue;
        }
        if (!result?.id) throw new Error("Gmail response missing message id");
        stage = "persist-sent";
        const sentAt = new Date();
        await db.transaction(async tx => {
          await tx.update(emailMessages).set({ status: "SENT", providerMessageId: result.id, sentAt }).where(eq(emailMessages.id, messageId!));
          await tx.update(emailCampaignRecipients).set({ status: "SENT", lastBatchId: logicalBatch!.id, providerMessageId: result.id, sentAt,
            processingStartedAt: null, errorMessage: null, failureCategory: null, updatedAt: sentAt }).where(eq(emailCampaignRecipients.id, target.id));
          if (target.companyId) await tx.insert(activityLogs).values({ ownerId, companyId: target.companyId, type: "EMAIL_SENT", description: `E-mail da campanha #${campaignId} enviado`, createdAt: sentAt });
        });
        sent++;
      } catch (error) {
        const category = classifyRuntimeFailure(sendStarted), exhausted = isSubrequestLimit(error);
        const diagnostic = error instanceof SendFailure ? error : runtimeFailure(error) ||
          (["control", "duplicate", "prepare", "send-barrier", "persist-sent", "provider-rejection"].includes(stage)
            ? databaseFailure(error) : new SendFailure("RUNTIME_FAILURE", "CAMPAIGN_RUNTIME_FAILURE"));
        deferredReason = { stage, category, causeCategory: diagnostic.category, errorCode: diagnostic.code };
        console.error({ event: "campaign.recipient", campaignId, recipientId: target.id, batchId: logicalBatch?.id, chunkId,
          attempt: (claimedTarget?.attempts ?? target.attempts) + Number(sendStarted), stage, category, causeCategory: diagnostic.category, errorCode: diagnostic.code, infrastructureLimit: exhausted });
        // Best effort only. If the invocation cannot do ANY more I/O, the lease
        // expires and the durable PREPARED/SENDING barrier drives recovery.
        try {
          if (sendStarted && messageId) {
            await db.transaction(async tx => {
              // Do not overwrite a successful commit whose acknowledgement was lost.
              await tx.update(emailMessages).set({ status: "UNCERTAIN", errorMessage: UNCERTAIN_NOTICE }).where(and(eq(emailMessages.id, messageId!), inArray(emailMessages.status, ["PREPARED", "SENDING"])));
              await tx.update(emailCampaignRecipients).set({ status: "UNCERTAIN", lastBatchId: logicalBatch!.id, processingStartedAt: null,
                failureCategory: category, errorMessage: UNCERTAIN_NOTICE, updatedAt: new Date() }).where(and(eq(emailCampaignRecipients.id, target.id), eq(emailCampaignRecipients.status, "PROCESSING")));
            });
          } else {
            await db.transaction(async tx => {
              if (messageId) await tx.update(emailMessages).set({ status: "PREPARED" }).where(eq(emailMessages.id, messageId));
              await tx.update(emailCampaignRecipients).set({ status: "PENDING", processingStartedAt: null, messageId: null, attempts: target.attempts,
                failureCategory: category, errorMessage: INFRASTRUCTURE_NOTICE, updatedAt: new Date() }).where(and(eq(emailCampaignRecipients.id, target.id),
                  claimedTarget ? eq(emailCampaignRecipients.status, "PROCESSING") : eq(emailCampaignRecipients.status, "PENDING")));
            });
          }
        } catch { /* Recover in a fresh invocation. Never continue sending. */ }
        deferred++;
        break;
      }
    }
    console.info({ event: "campaign.chunk", campaignId, batchId: logicalBatch?.id, chunkId, sent, failed, skipped, retried, deferred, ...(deferredReason ? { deferredReason } : {}) });
    return { processed: sent + failed + skipped + retried, sent, failed, skipped, retried, deferred, ...(deferredReason ? { deferredReason } : {}), ...await finalize() };
  } catch (error) {
    const oauth = error instanceof GmailOAuthError ? error : null;
    if (oauth?.requiresReconnect && oauthAccount) {
      try { await db.update(emailAccounts).set({ needsReconnect: true }).where(and(eq(emailAccounts.ownerId, ownerId), eq(emailAccounts.provider, "GMAIL"), eq(emailAccounts.encryptedRefreshToken, oauthAccount.encryptedRefreshToken))); } catch { /* Existing OAuth failure still pauses the campaign. */ }
    }
    const needsUserAction = oauth?.requiresUserAction || false;
    const notice = oauth?.message || INFRASTRUCTURE_NOTICE;
    console.error({ event: "campaign.chunk", campaignId, batchId: logicalBatch?.id, chunkId, stage,
      category: needsUserAction ? "AUTHENTICATION_FAILURE" : "INFRASTRUCTURE_FAILURE",
      infrastructureLimit: isSubrequestLimit(error),
      ...(oauth ? { errorCode: oauth.code, oauthCode: oauth.oauthCode, httpStatus: oauth.httpStatus, requiresReconnect: oauth.requiresReconnect } : {}),
    });
    try { await db.update(emailCampaigns).set({ processingNotice: notice, ...(needsUserAction ? { status: "PAUSED" } : {}), nextRunAt: sql`greatest(coalesce(${emailCampaigns.nextRunAt}, 0), ${Date.now() + 60_000})`, updatedAt: new Date() })
      .where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.status, "RUNNING"), eq(emailCampaigns.lockUntil, campaign.lockUntil!))); } catch { /* Lease expiry is the fallback. */ }
    return { campaignId, processed: sent + failed + skipped + retried, completed: false, paused: needsUserAction, deferred: true, locked: false, requiresReconnect: oauth?.requiresReconnect || false, errorCode: oauth?.code, notice };
  } finally {
    try { await db.update(emailCampaigns).set({ lockUntil: null }).where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.lockUntil, campaign.lockUntil!))); } catch { /* expires */ }
    try { await db.delete(campaignOwnerLeases).where(and(eq(campaignOwnerLeases.ownerId, ownerId), eq(campaignOwnerLeases.token, token))); } catch { /* expires */ }
  }
}

export async function findDueCampaigns(limit = 1) {
  const db = getDb(), now = new Date();
  return db.select({ id: emailCampaigns.id, ownerId: emailCampaigns.ownerId }).from(emailCampaigns).where(and(
    or(and(eq(emailCampaigns.status, "RUNNING"), or(isNull(emailCampaigns.nextRunAt), lte(emailCampaigns.nextRunAt, now))), staleCampaignCondition()),
    or(isNull(emailCampaigns.lockUntil), lte(emailCampaigns.lockUntil, now)),
  )).orderBy(asc(emailCampaigns.updatedAt), asc(emailCampaigns.id)).limit(limit);
}
