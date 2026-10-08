import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb, withCampaignDb } from '@/db';
import { activityLogs, campaignOwnerLeases, companies, crmSettings, documentSendBatches as batches, documentSendItems as items, emailAccounts, emailMessages, templateAttachments } from '@/db/schema';
import { acquireSendLease, releaseSendLease } from './shared-send-control';
import { dailyCampaignUsage } from './campaign-quota';
import { sendingDayWindow } from './settings';
import { GmailOAuthError, GMAIL_SEND_SCOPE, decryptToken, encodeRawEmail, refreshAccessToken } from './gmail';
import { classifyGmailFailure, MAX_ATTEMPTS, UNCERTAIN_NOTICE } from './campaign-policy';
import { attachmentStorage } from './attachment-storage';
import { validateAttachmentSet } from './attachments';
import { contentHash, smartStorage } from './smart-send-storage';
import { ownedBatch, ownedItems, requireBatch } from './smart-send-service';
import { recoverSmartStatus, recipientReview, SmartSendError } from './smart-send-policy';
type Batch = typeof batches.$inferSelect;
type Item = typeof items.$inferSelect;
const STALE_MS = 10 * 60_000;
const stale = () => sql`exists (select 1 from ${items} where ${items.batchId} = ${batches.id} and ${items.sendStatus} = 'PROCESSING' and ${items.processingAt} <= ${Date.now() - STALE_MS})`;
export async function findDueSmartBatch() {
  return (await getDb().select().from(batches).where(and(or(and(eq(batches.status, 'RUNNING'), or(isNull(batches.nextRunAt), lte(batches.nextRunAt, new Date()))), stale()),
    or(isNull(batches.lockUntil), lte(batches.lockUntil, new Date())))).orderBy(asc(batches.updatedAt), asc(batches.id)).limit(1))[0];
}
async function recover(batch: Batch) {
  const db = getDb();
  const rows = await db.select({ item: items, message: { id: emailMessages.id, status: emailMessages.status, providerMessageId: emailMessages.providerMessageId, sentAt: emailMessages.sentAt } }).from(items).leftJoin(emailMessages, eq(items.messageId, emailMessages.id))
    .where(and(ownedItems(batch.ownerId, batch.id), eq(items.sendStatus, 'PROCESSING'), lte(items.processingAt, new Date(Date.now() - STALE_MS)))).limit(5);
  for (const { item, message } of rows) {
    const status = recoverSmartStatus(message?.status, batch.status === 'CANCELLED');
    await db.transaction(async tx => {
      if (status === 'UNCERTAIN' && message) await tx.update(emailMessages).set({ status: 'UNCERTAIN', errorMessage: UNCERTAIN_NOTICE }).where(and(eq(emailMessages.id, message.id), eq(emailMessages.status, 'SENDING')));
      await tx.update(items).set({ sendStatus: status, processingAt: null, messageId: status === 'PENDING' ? null : item.messageId, providerMessageId: message?.providerMessageId || null,
        sentAt: status === 'SENT' ? message?.sentAt : item.sentAt, error: status === 'UNCERTAIN' ? UNCERTAIN_NOTICE : null, updatedAt: new Date() })
        .where(and(eq(items.id, item.id), eq(items.sendStatus, 'PROCESSING'), eq(items.processingAt, item.processingAt!)));
    });
  }
  return rows.length;
}
async function finish(batch: Batch, token: string, nextRunAt = new Date(Date.now() + batch.intervalSeconds * 1000)) {
  const db = getDb();
  const rows = await db.select({ status: items.sendStatus, count: sql<number>`count(*)` }).from(items).where(ownedItems(batch.ownerId, batch.id)).groupBy(items.sendStatus);
  const count = (status: string) => Number(rows.find(r => r.status === status)?.count || 0);
  const status = count('UNCERTAIN') ? 'PAUSED' : count('PENDING') || count('PROCESSING') ? 'RUNNING' : 'COMPLETED';
  await db.update(batches).set({ status, nextRunAt, completedAt: status === 'COMPLETED' ? new Date() : null,
    ...(count('UNCERTAIN') ? { notice: UNCERTAIN_NOTICE } : {}), updatedAt: new Date() }).where(and(ownedBatch(batch.ownerId, batch.id), eq(batches.status, 'RUNNING'), eq(batches.lockToken, token)));
}
// A single PDF/message per invocation keeps memory and subrequests bounded.
export async function processSmartBatch(owner: string, id: number) {
  return withCampaignDb(async () => {
    const db = getDb(), deadline = Date.now() + 60_000, lease = await acquireSendLease(owner);
    if (!lease) return { locked: true };
    let batch: Batch | undefined, target: Item | undefined, messageId: number | undefined, armed = false;
    let account: typeof emailAccounts.$inferSelect | undefined;
    try {
      [batch] = await db.update(batches).set({ lockToken: lease.token, lockUntil: lease.expiresAt }).where(and(ownedBatch(owner, id),
        or(and(eq(batches.status, 'RUNNING'), or(isNull(batches.nextRunAt), lte(batches.nextRunAt, new Date()))), stale()),
        or(isNull(batches.lockUntil), lte(batches.lockUntil, new Date())))).returning();
      if (!batch) return { locked: true };
      if (await recover(batch)) { await finish(batch, lease.token); return { recovered: true }; }
      if (batch.status !== 'RUNNING') return { paused: true };
      const unresolved = await db.select({ id: items.id }).from(items).where(and(ownedItems(owner, id), inArray(items.sendStatus, ['PROCESSING', 'UNCERTAIN']))).limit(1);
      if (unresolved.length) { await finish(batch, lease.token); return { unresolved: true }; }
      const [settings] = await db.select().from(crmSettings).where(eq(crmSettings.ownerId, owner));
      const { start, next } = sendingDayWindow(settings?.timezone);
      const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(emailMessages).where(dailyCampaignUsage(owner, start, next));
      if (Number(total) >= (settings?.dailySendLimit || 100)) { await finish(batch, lease.token, next); return { dailyLimit: true }; }
      [target] = await db.select().from(items).where(and(ownedItems(owner, id), eq(items.sendStatus, 'PENDING'))).orderBy(asc(items.createdAt)).limit(1);
      if (!target) { await finish(batch, lease.token); return { completed: true }; }
      if (!target.confirmedAt || target.reviewStatus !== 'READY' || target.excluded || target.removedAt || target.duplicateOf || !target.fileReady || !target.readable || target.fileDeletedAt || !target.companyId || !target.recipient || !target.subject || !target.body) throw new SmartSendError('Documento não está aprovado para envio.');
      const [company] = await db.select().from(companies).where(and(eq(companies.id, target.companyId), eq(companies.ownerId, owner)));
      if (recipientReview(company) !== 'IDENTIFIED' || company.primaryEmail?.trim().toLowerCase() !== target.recipient) throw new SmartSendError('Destinatário alterado ou inválido. Envio bloqueado.');
      [account] = await db.select().from(emailAccounts).where(and(eq(emailAccounts.id, batch.accountId!), eq(emailAccounts.ownerId, owner), eq(emailAccounts.provider, 'GMAIL')));
      if (!account || account.email.trim().toLowerCase() !== batch.senderAddress || !account.scopes.split(/\s+/).includes(GMAIL_SEND_SCOPE)) throw new SmartSendError('Conta remetente indisponível. Reconecte a conta original.', 409);
      if (account.needsReconnect) throw new GmailOAuthError(0, 'invalid_grant');
      const bytes = await smartStorage().get(target.storageKey);
      if (bytes.length !== target.fileSize || await contentHash(bytes) !== target.contentHash) throw new SmartSendError('Integridade do PDF inválida.');
      const attachments = [{ id: target.id, name: target.fileName, mimeType: 'application/pdf', size: target.fileSize, content: bytes }];
      // Frozen IDs are server-side batch records, retained even after template edits.
      if (batch.commonAttachments.length) {
        const rows = await db.select().from(templateAttachments).where(and(eq(templateAttachments.ownerId, owner), inArray(templateAttachments.id, batch.commonAttachments.map(a => a.id))));
        for (const meta of batch.commonAttachments) {
          if (Date.now() >= deadline) throw new Error('SMART_CHUNK_DEADLINE');
          const row = rows.find(r => r.id === meta.id);
          if (!row?.ready || row.size !== meta.size || row.name !== meta.name || row.mimeType !== meta.mimeType) throw new SmartSendError('Anexo comum indisponível.');
          const content = await attachmentStorage().get(row.storageKey);
          if (content.byteLength !== row.size) throw new SmartSendError('Integridade do anexo comum inválida.');
          attachments.push({ ...meta, content: new Uint8Array(content) });
        }
      }
      validateAttachmentSet(attachments);
      const accessToken = await refreshAccessToken(await decryptToken(account.encryptedRefreshToken));
      if (Date.now() >= deadline || Date.now() + 35_000 >= +lease.expiresAt) throw new Error('SMART_CHUNK_DEADLINE');
      const from = settings?.senderName ? `${settings.senderName.replace(/[\r\n<>]/g, ' ').trim()} <${account.email}>` : account.email;
      const raw = encodeRawEmail({ from, to: target.recipient, subject: target.subject, body: target.body, attachments, messageId: target.rfcMessageId });
      const item = target, sender = account, snapshot = batch;
      // The batch row lock linearizes pause/cancel with the durable send barrier.
      messageId = await db.transaction(async tx => {
        const current = await requireBatch(owner, id, tx);
        if (current.status !== 'RUNNING' || current.lockToken !== lease.token || +lease.expiresAt <= Date.now() + 35_000) return undefined;
        const [fence] = await tx.select().from(campaignOwnerLeases).where(and(eq(campaignOwnerLeases.ownerId, owner), eq(campaignOwnerLeases.token, lease.token), gte(campaignOwnerLeases.expiresAt, new Date()))).for('update');
        if (!fence) return undefined;
        const [freshCompany] = await tx.select().from(companies).where(and(eq(companies.id, item.companyId!), eq(companies.ownerId, owner))).for('share');
        if (recipientReview(freshCompany) !== 'IDENTIFIED' || freshCompany.primaryEmail?.trim().toLowerCase() !== item.recipient) throw new SmartSendError('Destinatário alterado.');
        const [claimed] = await tx.update(items).set({ sendStatus: 'PROCESSING', processingAt: new Date(), attempts: item.attempts + 1, error: null, updatedAt: new Date() })
          .where(and(ownedItems(owner, id), eq(items.id, item.id), eq(items.sendStatus, 'PENDING'))).returning();
        if (!claimed) return undefined;
        const [message] = await tx.insert(emailMessages).values({ ownerId: owner, companyId: item.companyId, templateId: null, recipient: item.recipient!,
          subject: item.subject!, body: item.body!, attachments: attachments.map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })),
          status: 'SENDING', kind: 'SMART', rfcMessageId: item.rfcMessageId, emailAccountId: sender.id, senderAddress: snapshot.senderAddress, createdAt: new Date() }).returning();
        await tx.update(items).set({ messageId: message.id }).where(eq(items.id, item.id)); return message.id;
      });
      if (!messageId) return { interrupted: true };
      armed = true; // Any error from here is ambiguous unless Gmail explicitly rejects.
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', redirect: 'manual',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json().catch(() => null) as { id?: unknown } | null;
      if (!response.ok) {
        const retry = classifyGmailFailure(response.status, '') === 'RETRYABLE_PROVIDER_FAILURE' && item.attempts + 1 < MAX_ATTEMPTS;
        const error = `Gmail rejeitou o envio (HTTP ${response.status}); tentativa ${item.attempts + 1}/${MAX_ATTEMPTS}.`;
        await db.transaction(async tx => {
          const current = await requireBatch(owner, id, tx);
          const retryStatus = current.status === 'CANCELLED' ? 'SKIPPED' : 'PENDING';
          await tx.update(emailMessages).set({ status: retry ? 'RETRYABLE' : 'FAILED', errorMessage: error }).where(eq(emailMessages.id, messageId!));
          await tx.update(items).set({ sendStatus: retry ? retryStatus : 'FAILED', messageId: retry ? null : messageId, processingAt: null, error, updatedAt: new Date() }).where(eq(items.id, item.id));
        });
        armed = false;
      } else {
        if (typeof result?.id !== 'string' || !result.id) throw new Error('GMAIL_INVALID_RESPONSE');
        const sentAt = new Date();
        await db.transaction(async tx => {
          await tx.update(emailMessages).set({ status: 'SENT', sentAt, providerMessageId: result.id as string }).where(eq(emailMessages.id, messageId!));
          await tx.update(items).set({ sendStatus: 'SENT', sentAt, providerMessageId: result.id as string, processingAt: null, error: null, deliveryNextAt: new Date(Date.now() + 120_000), updatedAt: sentAt }).where(eq(items.id, item.id));
          await tx.insert(activityLogs).values({ ownerId: owner, companyId: item.companyId, type: 'EMAIL_SENT', description: `Envio Inteligente #${id} aceito pelo Gmail: ${item.fileName}`, createdAt: sentAt });
        });
        armed = false;
      }
      await finish(batch, lease.token); return { processed: 1 };
    } catch (error) {
      // If COMMIT acknowledgement was lost, conditional updates preserve SENT.
      if (armed && target && messageId) {
        try { await db.transaction(async tx => {
          await tx.update(emailMessages).set({ status: 'UNCERTAIN', errorMessage: UNCERTAIN_NOTICE }).where(and(eq(emailMessages.id, messageId!), eq(emailMessages.status, 'SENDING')));
          await tx.update(items).set({ sendStatus: 'UNCERTAIN', processingAt: null, error: UNCERTAIN_NOTICE, updatedAt: new Date() }).where(and(eq(items.id, target!.id), eq(items.sendStatus, 'PROCESSING')));
        }); } catch { /* Durable SENDING drives recovery after lease expiry. */ }
      } else if (target) {
        const permanent = error instanceof SmartSendError && error.status === 400;
        const attempts = target.infrastructureAttempts + 1;
        await db.update(items).set({ infrastructureAttempts: attempts, sendStatus: permanent || attempts >= 3 ? 'FAILED' : 'PENDING', error: permanent ? error.message : 'Falha de infraestrutura ou autenticação; envio não iniciado.', updatedAt: new Date() })
          .where(and(eq(items.id, target.id), eq(items.sendStatus, 'PENDING'))).catch(() => {});
      }
      if (error instanceof GmailOAuthError && error.requiresReconnect && account) await db.update(emailAccounts).set({ needsReconnect: true }).where(and(eq(emailAccounts.id, account.id), eq(emailAccounts.ownerId, owner), eq(emailAccounts.encryptedRefreshToken, account.encryptedRefreshToken))).catch(() => {});
      if (batch) {
        const pause = armed || error instanceof GmailOAuthError && error.requiresUserAction || error instanceof SmartSendError && error.status === 409;
        await db.update(batches).set({ ...(pause ? { status: 'PAUSED' } : {}), notice: armed ? UNCERTAIN_NOTICE : error instanceof GmailOAuthError ? error.message : 'Processamento adiado. Confira os resultados individuais.', nextRunAt: new Date(Date.now() + 60_000), updatedAt: new Date() })
          .where(and(ownedBatch(owner, id), eq(batches.lockToken, lease.token), eq(batches.status, 'RUNNING'))).catch(() => {});
      }
      return { deferred: true, uncertain: armed };
    } finally {
      if (batch) await db.update(batches).set({ lockToken: null, lockUntil: null }).where(and(ownedBatch(owner, id), eq(batches.lockToken, lease.token))).catch(() => {});
      await releaseSendLease(owner, lease.token).catch(() => {});
    }
  });
}
