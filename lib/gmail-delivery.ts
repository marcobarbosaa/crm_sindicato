import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb, withCampaignDb } from "@/db";
import { activityLogs, companies, emailAccounts, emailCampaignRecipients, emailCampaigns, emailDeliveryEvents, emailMessages, gmailDeliverySyncState } from "@/db/schema";
import { decryptToken, GmailOAuthError, hasDeliveryScope, refreshAccessToken } from "./gmail";
import { correlateDeliveryNotice, parseDeliveryStatus, type DeliveryNotice } from "./delivery-parser";
import { DELIVERY_LOOKBACK_MS, DELIVERY_WINDOW_MS } from "./delivery-policy";
import { DeliverySyncError, findOriginalProviderIds, listDeliveryCandidates, readDeliveryCandidate } from "./gmail-delivery-client";

const CHECK_INTERVAL_MS = 10 * 60_000;
const LEASE_MS = 5 * 60_000;
const OVERLAP_MS = 10 * 60_000;
type Campaign = typeof emailCampaigns.$inferSelect;
type Account = typeof emailAccounts.$inferSelect;
type Bounce = { id: string; threadId: string | null; receivedAt: number };

async function correlate(owner: string, campaign: Campaign, account: Account, notice: DeliveryNotice, bounce: Bounce, token: string, deadline: number) {
  // Include sends from ALL campaigns and individual sends when testing ambiguity.
  // Never restrict the recipient-only candidate search to the current campaign.
  const condition = and(eq(emailMessages.ownerId, owner), eq(emailMessages.status, "SENT"),
    sql`lower(btrim(${emailMessages.recipient})) = ${notice.recipient}`,
    gte(emailMessages.sentAt, new Date(bounce.receivedAt - DELIVERY_LOOKBACK_MS)), lte(emailMessages.sentAt, new Date(bounce.receivedAt)));
  let messages = await getDb().select().from(emailMessages).where(and(condition,
    notice.originalMessageIds.length ? inArray(emailMessages.rfcMessageId, notice.originalMessageIds) : undefined)).limit(2);
  let providerIds: string[] = [];
  // Gmail's opaque API id is not the RFC Message-ID. For a legacy send, resolve
  // the RFC reference within this connected mailbox, then compare the API id.
  if (!messages.length && notice.originalMessageIds.length === 1) {
    providerIds = await findOriginalProviderIds(token, notice.originalMessageIds[0], deadline);
    if (providerIds.length) messages = await getDb().select().from(emailMessages).where(and(condition, inArray(emailMessages.providerMessageId, providerIds))).limit(2);
  }
  const match = correlateDeliveryNotice(notice, messages, campaign.id, bounce.receivedAt, DELIVERY_LOOKBACK_MS, providerIds);
  if (!match) return null;
  const message = messages.find(row => row.id === match.id)!;
  // Newly sent messages are bound to the sending account; legacy messages require
  // the provider reference resolved in that mailbox, never just a recipient.
  if ((message.emailAccountId !== account.id || message.senderAddress !== account.email.trim().toLowerCase()) && !providerIds.includes(message.providerMessageId || "")) return null;
  const [recipient] = await getDb().select().from(emailCampaignRecipients).where(and(
    eq(emailCampaignRecipients.campaignId, campaign.id), eq(emailCampaignRecipients.messageId, message.id), eq(emailCampaignRecipients.status, "SENT"),
    sql`lower(btrim(${emailCampaignRecipients.recipient})) = ${notice.recipient}`,
    sql`exists (select 1 from ${emailCampaigns} where ${emailCampaigns.id} = ${campaign.id} and ${emailCampaigns.ownerId} = ${owner})`,
  )).limit(1);
  return recipient ? { recipient, message } : null;
}

export async function recordDeliveryEvent(owner: string, campaignId: number, recipientId: number, messageId: number, notice: DeliveryNotice, bounce: Bounce) {
  const db = getDb(), now = new Date();
  return db.transaction(async tx => {
    const [target] = await tx.select({ recipient: emailCampaignRecipients, message: emailMessages }).from(emailCampaignRecipients)
      .innerJoin(emailCampaigns, and(eq(emailCampaigns.id, emailCampaignRecipients.campaignId), eq(emailCampaigns.ownerId, owner)))
      .innerJoin(emailMessages, and(eq(emailMessages.id, emailCampaignRecipients.messageId), eq(emailMessages.ownerId, owner), eq(emailMessages.campaignId, campaignId)))
      .where(and(eq(emailCampaignRecipients.id, recipientId), eq(emailCampaignRecipients.campaignId, campaignId),
        eq(emailCampaignRecipients.messageId, messageId), eq(emailCampaignRecipients.status, "SENT"), eq(emailMessages.status, "SENT"),
        sql`lower(btrim(${emailCampaignRecipients.recipient})) = ${notice.recipient}`)).limit(1);
    if (!target) return false;
    const [inserted] = await tx.insert(emailDeliveryEvents).values({ ownerId: owner, campaignId, campaignRecipientId: recipientId, emailMessageId: messageId,
      companyId: target.recipient.companyId, recipient: notice.recipient, gmailMessageId: bounce.id, gmailThreadId: bounce.threadId,
      eventType: notice.deliveryStatus, category: notice.category, smtpStatus: notice.smtpStatus, diagnostic: notice.diagnostic,
      detectedAt: new Date(bounce.receivedAt), createdAt: now,
    }).onConflictDoNothing().returning({ id: emailDeliveryEvents.id });
    if (!inserted) return false;
    // Permanent address failure is sticky. An older/delayed report cannot erase it.
    const [updated] = await tx.update(emailCampaignRecipients).set({ deliveryStatus: notice.deliveryStatus, deliveryFailureCategory: notice.category,
      deliveryDiagnosticCode: notice.smtpStatus, deliveryErrorMessage: notice.diagnostic, bouncedAt: new Date(bounce.receivedAt), bounceMessageId: bounce.id, deliveryCheckedAt: now,
    }).where(and(eq(emailCampaignRecipients.id, recipientId), eq(emailCampaignRecipients.campaignId, campaignId),
      or(isNull(emailCampaignRecipients.bouncedAt), lte(emailCampaignRecipients.bouncedAt, new Date(bounce.receivedAt))),
      notice.invalid ? undefined : ne(emailCampaignRecipients.deliveryStatus, "BOUNCED"),
    )).returning({ id: emailCampaignRecipients.id });
    if (updated && notice.invalid && target.recipient.companyId) {
      // This comparison is inside the UPDATE, not a stale application snapshot.
      const [company] = await tx.update(companies).set({ primaryEmailStatus: "INVALID", primaryEmailStatusReason: notice.category,
        primaryEmailStatusUpdatedAt: now,
      }).where(and(eq(companies.id, target.recipient.companyId), eq(companies.ownerId, owner),
        sql`lower(btrim(${companies.primaryEmail})) = ${notice.recipient}`, ne(companies.primaryEmailStatus, "INVALID"),
      )).returning({ id: companies.id });
      if (company) await tx.insert(activityLogs).values({ ownerId: owner, companyId: company.id, type: "EMAIL_ADDRESS_INVALIDATED",
        description: `Endereço marcado como inválido após devolução da campanha #${campaignId}: ${notice.category}.`, createdAt: now });
    }
    return true;
  });
}

async function checkCampaign(campaign: Campaign) {
  const db = getDb(), owner = campaign.ownerId, now = new Date();
  const deadline = Date.now() + 60_000;
  const ownedCampaign = and(eq(emailCampaigns.id, campaign.id), eq(emailCampaigns.ownerId, owner));
  const [account] = await db.select().from(emailAccounts).where(and(eq(emailAccounts.ownerId, owner), eq(emailAccounts.provider, "GMAIL"))).limit(1);
  if (!account) {
    await db.update(emailCampaigns).set({ deliveryNextCheckAt: new Date(+now + CHECK_INTERVAL_MS) }).where(ownedCampaign);
    return { outcome: "account_missing" };
  }
  await db.insert(gmailDeliverySyncState).values({ campaignId: campaign.id, ownerId: owner, emailAccountId: account.id, accountConnectedAt: account.updatedAt, updatedAt: now }).onConflictDoNothing();
  const token = crypto.randomUUID(), ownedState = and(eq(gmailDeliverySyncState.campaignId, campaign.id), eq(gmailDeliverySyncState.ownerId, owner));
  const [state] = await db.update(gmailDeliverySyncState).set({ lockToken: token, lockUntil: new Date(+now + LEASE_MS), updatedAt: now })
    .where(and(ownedState, or(isNull(gmailDeliverySyncState.lockUntil), lte(gmailDeliverySyncState.lockUntil, now)))).returning();
  if (!state) return { outcome: "locked" };
  const leasedState = and(ownedState, eq(gmailDeliverySyncState.lockToken, token));
  const expires = +campaign.completedAt! + DELIVERY_WINDOW_MS;
  const start = Math.max(+(campaign.startedAt || campaign.createdAt), +campaign.completedAt! - DELIVERY_LOOKBACK_MS);
  let events = 0;
  try {
    if (account.needsReconnect) throw new GmailOAuthError(0, "invalid_grant");
    if (!hasDeliveryScope(account.scopes)) throw new DeliverySyncError("GMAIL_READ_SCOPE_MISSING");
    const accessToken = await refreshAccessToken(await decryptToken(account.encryptedRefreshToken));
    const reset = state.emailAccountId !== account.id || +state.accountConnectedAt !== +account.updatedAt;
    const after = !reset && state.scanAfter ? +state.scanAfter : !reset && state.lastCheckedAt ? Math.max(start, +state.lastCheckedAt - OVERLAP_MS) : start;
    const before = !reset && state.scanBefore ? +state.scanBefore : Math.min(Date.now(), expires);
    const pageToken = reset ? null : state.pageToken;
    let incomplete = reset ? false : state.incomplete;
    // Persist stable query bounds before paging. New mail cannot shift this page set.
    await db.update(gmailDeliverySyncState).set({ scanAfter: new Date(after), scanBefore: new Date(before), emailAccountId: account.id,
      accountConnectedAt: account.updatedAt, ...(reset ? { lastCheckedAt: null, pageToken: null, incomplete: false } : {}), updatedAt: now }).where(leasedState);
    const page = await listDeliveryCandidates(accessToken, after, before, pageToken, deadline);
    for (const id of page.ids) {
      try {
        const bounce = await readDeliveryCandidate(accessToken, id, deadline);
        if (bounce.receivedAt < start || bounce.receivedAt > expires) continue;
        const parsed = parseDeliveryStatus(bounce.raw);
        incomplete ||= parsed.incomplete;
        for (const notice of parsed.notices) {
          if (Date.now() >= deadline) throw new DeliverySyncError("DELIVERY_DEADLINE");
          const match = await correlate(owner, campaign, account, notice, bounce, accessToken, deadline);
          if (!match) { incomplete = true; continue; }
          if (await recordDeliveryEvent(owner, campaign.id, match.recipient.id, match.message.id, notice, bounce)) events++;
        }
      } catch (error) {
        if (error instanceof DeliverySyncError && ["MESSAGE_TOO_LARGE", "GMAIL_NOT_FOUND"].includes(error.code)) incomplete = true;
        else throw error;
      }
    }
    await db.transaction(async tx => {
      // Fencing: an expired lease cannot move another invocation's checkpoint.
      const [fence] = await tx.update(gmailDeliverySyncState).set({ pageToken: page.nextPageToken, incomplete,
        scanAfter: page.nextPageToken ? new Date(after) : null, scanBefore: page.nextPageToken ? new Date(before) : null,
        lastCheckedAt: page.nextPageToken ? state.lastCheckedAt : new Date(before), lastError: incomplete ? "PARTIAL_ANALYSIS" : null, updatedAt: new Date(),
      }).where(and(leasedState, gte(gmailDeliverySyncState.lockUntil, new Date()))).returning({ campaignId: gmailDeliverySyncState.campaignId });
      if (!fence) return;
      if (!page.nextPageToken && !incomplete) {
        await tx.update(emailCampaignRecipients).set({ deliveryStatus: "NO_KNOWN_FAILURE", deliveryCheckedAt: new Date(before) }).where(and(
          eq(emailCampaignRecipients.campaignId, campaign.id), eq(emailCampaignRecipients.status, "SENT"),
          inArray(emailCampaignRecipients.deliveryStatus, ["PENDING", "NO_KNOWN_FAILURE"]),
          gte(emailCampaignRecipients.sentAt, new Date(start)), lte(emailCampaignRecipients.sentAt, new Date(before)),
          sql`exists (select 1 from ${emailMessages} where ${emailMessages.id} = ${emailCampaignRecipients.messageId}
            and ${emailMessages.ownerId} = ${owner} and ${emailMessages.emailAccountId} = ${account.id} and ${emailMessages.senderAddress} = ${account.email.trim().toLowerCase()})`,
          sql`exists (select 1 from ${emailCampaigns} where ${emailCampaigns.id} = ${campaign.id} and ${emailCampaigns.ownerId} = ${owner})`,
        ));
      }
      await tx.update(emailCampaigns).set({ deliveryCheckedAt: page.nextPageToken ? campaign.deliveryCheckedAt : new Date(before),
        deliveryNextCheckAt: new Date(Date.now() + (page.nextPageToken ? 0 : CHECK_INTERVAL_MS)),
        deliveryCompletedAt: !page.nextPageToken && before >= expires ? new Date() : null,
      }).where(ownedCampaign);
    });
    return { outcome: page.nextPageToken ? "partial" : "checked", events };
  } catch (error) {
    const code = error instanceof GmailOAuthError ? error.code : error instanceof DeliverySyncError ? error.code : "DELIVERY_SYNC_UNAVAILABLE";
    if (error instanceof GmailOAuthError && error.requiresReconnect) await db.update(emailAccounts).set({ needsReconnect: true })
      .where(and(eq(emailAccounts.id, account.id), eq(emailAccounts.ownerId, owner), eq(emailAccounts.encryptedRefreshToken, account.encryptedRefreshToken)));
    // 403 can also be administrative denial/quota. It never invalidates addresses
    // or disables the sending authorization. The read error is visible in reports.
    await db.update(gmailDeliverySyncState).set({ lastError: code, updatedAt: new Date(),
      // Expired/rejected page tokens restart the same fixed interval; committed
      // events remain deduplicated. A bad token cannot pin the scan forever.
      ...(code === "GMAIL_BAD_REQUEST" && state.pageToken ? { pageToken: null } : {}),
    }).where(leasedState);
    await db.update(emailCampaigns).set({ deliveryNextCheckAt: new Date(Date.now() + CHECK_INTERVAL_MS) }).where(ownedCampaign);
    console.info({ event: "gmail.delivery.sync", campaignId: campaign.id, outcome: code });
    return { outcome: code, events };
  } finally {
    await db.update(gmailDeliverySyncState).set({ lockToken: null, lockUntil: null }).where(leasedState);
  }
}

export async function processPendingDeliveryChecks() {
  return withCampaignDb(async () => {
    const now = new Date();
    // Maintenance scheduler discovers owners from trusted rows, never HTTP input.
    // Recent completed campaigns only; at most one mailbox page per invocation.
    const [campaign] = await getDb().select().from(emailCampaigns).where(and(
      eq(emailCampaigns.status, "COMPLETED"), eq(emailCampaigns.deliveryMonitoringEnabled, true), isNull(emailCampaigns.deliveryCompletedAt),
      gte(emailCampaigns.completedAt, new Date(+now - DELIVERY_LOOKBACK_MS)),
      or(isNull(emailCampaigns.deliveryNextCheckAt), lte(emailCampaigns.deliveryNextCheckAt, now)),
    )).orderBy(asc(emailCampaigns.deliveryNextCheckAt), asc(emailCampaigns.completedAt)).limit(1);
    return campaign ? checkCampaign(campaign) : { outcome: "idle" };
  });
}
