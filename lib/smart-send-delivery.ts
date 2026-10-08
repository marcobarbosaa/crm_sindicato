import { and, asc, eq, gte, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { activityLogs, companies, documentSendDeliveryEvents as events, documentSendItems as items, emailAccounts, emailMessages } from '@/db/schema';
import { decryptToken, GmailOAuthError, hasDeliveryScope, refreshAccessToken } from './gmail';
import { DELIVERY_LOOKBACK_MS, DELIVERY_WINDOW_MS } from './delivery-policy';
import { parseDeliveryStatus } from './delivery-parser';
import { DeliverySyncError, listDeliveryCandidates, readDeliveryCandidate } from './gmail-delivery-client';
// Separate checkpoint and lease. Reuses the read-only Gmail client and DSN parser.
export async function checkSmartDelivery() {
  const db = getDb(), now = new Date(), token = crypto.randomUUID(), deadline = Date.now() + 55_000;
  const [candidate] = await db.select().from(items).where(and(eq(items.sendStatus, 'SENT'), isNotNull(items.deliveryNextAt), lte(items.deliveryNextAt, now),
    gte(items.sentAt, new Date(+now - DELIVERY_LOOKBACK_MS)), or(isNull(items.deliveryLockUntil), lte(items.deliveryLockUntil, now))))
    .orderBy(asc(items.deliveryNextAt)).limit(1);
  if (!candidate) return { outcome: 'idle' };
  const [item] = await db.update(items).set({ deliveryLockToken: token, deliveryLockUntil: new Date(+now + 5 * 60_000) }).where(and(eq(items.id, candidate.id),
    or(isNull(items.deliveryLockUntil), lte(items.deliveryLockUntil, now)))).returning();
  if (!item) return { outcome: 'locked' };
  const fence = and(eq(items.id, item.id), eq(items.ownerId, item.ownerId), eq(items.deliveryLockToken, token));
  let account: typeof emailAccounts.$inferSelect | undefined;
  try {
    const [message] = await db.select().from(emailMessages).where(and(eq(emailMessages.id, item.messageId!), eq(emailMessages.ownerId, item.ownerId), eq(emailMessages.status, 'SENT')));
    if (!message?.emailAccountId || message.rfcMessageId !== item.rfcMessageId) throw new DeliverySyncError('MESSAGE_REFERENCE_MISSING');
    [account] = await db.select().from(emailAccounts).where(and(eq(emailAccounts.id, message.emailAccountId), eq(emailAccounts.ownerId, item.ownerId)));
    if (!account || account.email.trim().toLowerCase() !== message.senderAddress) throw new DeliverySyncError('SENDING_ACCOUNT_MISSING');
    if (account.needsReconnect) throw new GmailOAuthError(0, 'invalid_grant');
    if (!hasDeliveryScope(account.scopes)) throw new DeliverySyncError('GMAIL_READ_SCOPE_MISSING');
    const accessToken = await refreshAccessToken(await decryptToken(account.encryptedRefreshToken));
    const start = +item.sentAt!, expires = start + DELIVERY_WINDOW_MS, before = item.deliveryBefore ? +item.deliveryBefore : Math.min(Date.now(), expires);
    // Stable bounds across pages; a complete rescan handles delayed mailbox indexing.
    const page = await listDeliveryCandidates(accessToken, start, before, item.deliveryPageToken, deadline);
    let incomplete = item.deliveryIncomplete, eventCount = 0;
    for (const id of page.ids) {
      const bounce = await readDeliveryCandidate(accessToken, id, deadline);
      if (bounce.receivedAt < start || bounce.receivedAt > expires) continue;
      const parsed = parseDeliveryStatus(bounce.raw); incomplete ||= parsed.incomplete;
      for (const notice of parsed.notices) {
        if (notice.recipient !== item.recipient || !notice.originalMessageIds.includes(item.rfcMessageId) || notice.originalMessageIds.length !== 1) continue;
        await db.transaction(async tx => {
          const [current] = await tx.select().from(items).where(and(fence, gte(items.deliveryLockUntil, new Date()))).for('update');
          if (!current) return;
          const [inserted] = await tx.insert(events).values({ itemId: item.id, ownerId: item.ownerId, gmailMessageId: bounce.id, status: notice.deliveryStatus, category: notice.category,
            diagnostic: notice.diagnostic, createdAt: new Date() }).onConflictDoNothing().returning();
          if (!inserted) return;
          if (current.deliveryStatus !== 'BOUNCED') await tx.update(items).set({ deliveryStatus: notice.deliveryStatus, deliveryError: notice.diagnostic, bounceMessageId: bounce.id }).where(fence);
          if (notice.invalid && item.companyId) {
            const [company] = await tx.update(companies).set({ primaryEmailStatus: 'INVALID', primaryEmailStatusReason: notice.category, primaryEmailStatusUpdatedAt: new Date() }).where(and(
              eq(companies.id, item.companyId), eq(companies.ownerId, item.ownerId), sql`lower(btrim(${companies.primaryEmail})) = ${notice.recipient}`, ne(companies.primaryEmailStatus, 'INVALID'))).returning();
            if (company) await tx.insert(activityLogs).values({ ownerId: item.ownerId, companyId: company.id, type: 'EMAIL_ADDRESS_INVALIDATED', description: `Devolução do Envio Inteligente #${item.batchId}: ${notice.category}.`, createdAt: new Date() });
          }
          eventCount++;
        });
      }
    }
    await db.transaction(async tx => {
      const [current] = await tx.select().from(items).where(and(fence, gte(items.deliveryLockUntil, new Date()))).for('update');
      if (!current) return;
      await tx.update(items).set({ deliveryPageToken: page.nextPageToken, deliveryBefore: page.nextPageToken ? new Date(before) : null,
        deliveryIncomplete: page.nextPageToken ? incomplete : false,
        deliveryCheckedAt: page.nextPageToken ? item.deliveryCheckedAt : new Date(before),
        deliveryNextAt: !page.nextPageToken && before >= expires ? null : new Date(Date.now() + (page.nextPageToken ? 0 : 10 * 60_000)),
        ...(!page.nextPageToken && !incomplete && ['PENDING', 'NO_KNOWN_FAILURE'].includes(current.deliveryStatus) ? { deliveryStatus: 'NO_KNOWN_FAILURE', deliveryError: null } : incomplete ? { deliveryError: 'PARTIAL_ANALYSIS' } : {}),
      }).where(fence);
    });
    return { outcome: 'checked', events: eventCount };
  } catch (error) {
    const code = error instanceof GmailOAuthError ? error.code : error instanceof DeliverySyncError ? error.code : 'DELIVERY_SYNC_UNAVAILABLE';
    if (error instanceof GmailOAuthError && error.requiresReconnect && account) await db.update(emailAccounts).set({ needsReconnect: true }).where(and(eq(emailAccounts.id, account.id), eq(emailAccounts.encryptedRefreshToken, account.encryptedRefreshToken)));
    await db.update(items).set({ deliveryError: code, deliveryNextAt: new Date(Date.now() + 10 * 60_000), ...(code === 'GMAIL_BAD_REQUEST' ? { deliveryPageToken: null } : {}) }).where(fence);
    return { outcome: code };
  } finally { await db.update(items).set({ deliveryLockToken: null, deliveryLockUntil: null }).where(fence); }
}
