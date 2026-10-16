import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { companies, crmSettings, documentSendBatches as batches, documentSendItems as items, emailAccounts, emailMessages, emailTemplates, templateAttachments } from '@/db/schema';
import { storageConfig } from './attachment-storage';
import { SmartSendError, smartLimits } from './smart-send-policy';
import { importResult } from './smart-import-protocol';
import { ownedBatch, ownedItems } from './smart-send-scope';
import { parseSmartContract, smartNumericId } from './smart-send-contract';
import { reviewOverview } from './smart-review-policy';
import { dailyCampaignUsage } from './campaign-quota';
import { sendingDayWindow } from './settings';

// Explicit read projection: retain review previews and audit status, leave storage,
// delivery cursors and leases in the database. Never use this for send decisions.
const detailItem = {
  id: items.id, batchId: items.batchId, fileName: items.fileName, fileSize: items.fileSize,
  contentHash: items.contentHash, fileReady: items.fileReady, readable: items.readable,
  fileDeletedAt: items.fileDeletedAt, duplicateOf: items.duplicateOf,
  companyId: items.companyId, companyName: items.companyName, companyCnpj: items.companyCnpj,
  recipient: items.recipient, extractedCnpjs: items.extractedCnpjs, candidates: items.candidates,
  identificationMethod: items.identificationMethod, reviewStatus: items.reviewStatus,
  confirmedAt: items.confirmedAt, excluded: items.excluded, subject: items.subject, body: items.body,
  sendStatus: items.sendStatus, messageId: items.messageId, processingAt: items.processingAt, sentAt: items.sentAt, error: items.error,
  deliveryStatus: items.deliveryStatus, deliveryError: items.deliveryError, deliveryCheckedAt: items.deliveryCheckedAt,
  createdAt: items.createdAt, updatedAt: items.updatedAt,
};

export async function getSmartBatch(owner: string, id: number) {
  const db = getDb();
  const [batch] = await db.select({
    id: batches.id, name: batches.name, status: batches.status, revision: batches.revision,
    templateId: batches.templateId, templateName: batches.templateName, senderAddress: batches.senderAddress,
    accountId: batches.accountId, commonAttachments: batches.commonAttachments, intervalSeconds: batches.intervalSeconds,
    notice: batches.notice, nextRunAt: batches.nextRunAt, confirmedAt: batches.confirmedAt,
    completedAt: batches.completedAt, createdAt: batches.createdAt, updatedAt: batches.updatedAt,
    deletionRequestedAt: batches.deletionRequestedAt,
  }).from(batches).where(ownedBatch(owner, id));
  if (!batch) throw new SmartSendError('Lote não encontrado.', 404);
  if (batch.deletionRequestedAt) throw new SmartSendError('Lote em exclusão ou já excluído.', 409);
  const rows = await db.select(detailItem).from(items).where(and(ownedItems(owner, id), isNull(items.removedAt))).orderBy(asc(items.createdAt));
  const [settings] = await db.select({ dailySendLimit: crmSettings.dailySendLimit, signature: crmSettings.signature, timezone: crmSettings.timezone }).from(crmSettings).where(eq(crmSettings.ownerId, owner));
  const { start, next } = sendingDayWindow(settings?.timezone);
  const [{ used }] = await db.select({ used: sql<number>`count(*)` }).from(emailMessages).where(dailyCampaignUsage(owner, start, next));
  const dailyLimit = settings?.dailySendLimit || 100;
  const [account] = await db.select({ email: emailAccounts.email }).from(emailAccounts).where(and(eq(emailAccounts.ownerId, owner), eq(emailAccounts.provider, 'GMAIL')));
  const candidateIds = new Set<number>();
  const companyIds = new Set<number | null>();
  const summary = { documents: rows.length, companies: 0, eligible: 0, blocked: 0, duplicates: 0, withoutEmail: 0, excluded: 0 };
  for (const row of rows) {
    for (const candidate of row.candidates) candidateIds.add(Number(candidate));
    const eligible = !row.excluded && row.reviewStatus === 'READY' && row.confirmedAt && row.fileReady && !row.fileDeletedAt;
    if (eligible) { summary.eligible++; companyIds.add(row.companyId); }
    else if (!row.excluded) summary.blocked++;
    if (row.duplicateOf) summary.duplicates++;
    if (!row.recipient) summary.withoutEmail++;
    if (row.excluded) summary.excluded++;
  }
  summary.companies = companyIds.size;
  const suggestions = candidateIds.size ? await db.select({ id: companies.id, name: companies.name, tradeName: companies.tradeName, cnpj: companies.cnpj, primaryEmail: companies.primaryEmail, primaryEmailStatus: companies.primaryEmailStatus }).from(companies)
    .where(and(eq(companies.ownerId, owner), inArray(companies.id, [...candidateIds]))) : [];
  const byId = new Map(suggestions.map(company => [Number(company.id), company]));
  return { batch: { ...batch, id: parseSmartContract(smartNumericId, batch.id, 'batch-detail-id') }, items: rows.map(row => ({ ...row, suggestions: [...new Set(row.candidates)].flatMap(id => {
    const company = byId.get(Number(id)); return company ? [company] : [];
  }) })), summary, reviewSummary: reviewOverview(rows), limits: smartLimits(storageConfig), dailyLimit, sender: account?.email || null,
    signature: settings?.signature || '', timezone: settings?.timezone || 'America/Sao_Paulo',
    quota: { limit: dailyLimit, used: Number(used), available: Math.max(0, dailyLimit - Number(used)), resetsAt: next, checkedAt: new Date() } };
}

export async function getSmartImportStatus(owner: string, batchId: number) {
  const db = getDb();
  const [batch] = await db.select({ id: batches.id, deletionRequestedAt: batches.deletionRequestedAt }).from(batches).where(ownedBatch(owner, batchId));
  if (!batch) throw new SmartSendError('Lote não encontrado.', 404);
  if (batch.deletionRequestedAt) throw new SmartSendError('Lote em exclusão ou já excluído.', 409);
  // Keep removed rows: recovery must know that an old upload was deleted.
  const rows = await db.select({ id: items.id, contentHash: items.contentHash, fileReady: items.fileReady,
    fileDeletedAt: items.fileDeletedAt, removedAt: items.removedAt, duplicateOf: items.duplicateOf,
    reviewStatus: items.reviewStatus, error: items.error }).from(items).where(ownedItems(owner, batchId));
  return { batchId: parseSmartContract(smartNumericId, batch.id, 'import-status-id'), items: rows.map(importResult) };
}

export async function smartCatalog(owner: string, search?: string) {
  const db = getDb();
  if (search !== undefined) {
    const term = search.trim().slice(0, 100), digits = term.replace(/\D/g, '');
    if (!term) return [];
    return db.select({ id: companies.id, name: companies.name, tradeName: companies.tradeName, cnpj: companies.cnpj, primaryEmail: companies.primaryEmail, primaryEmailStatus: companies.primaryEmailStatus }).from(companies)
      .where(and(eq(companies.ownerId, owner), or(ilike(companies.name, `%${term}%`), ilike(companies.tradeName, `%${term}%`), ilike(companies.cnpj, `%${term}%`),
        digits.length >= 2 ? ilike(sql<string>`regexp_replace(${companies.cnpj}, '[^0-9]', '', 'g')`, `%${digits}%`) : undefined))).orderBy(asc(companies.name), asc(companies.id)).limit(30);
  }
  const templates = await db.select().from(emailTemplates).where(eq(emailTemplates.ownerId, owner)).limit(100);
  const attachments = await db.select({ id: templateAttachments.id, name: templateAttachments.name, mimeType: templateAttachments.mimeType,
    size: templateAttachments.size, templateId: templateAttachments.templateId }).from(templateAttachments)
    .where(and(eq(templateAttachments.ownerId, owner), eq(templateAttachments.ready, true)));
  return templates.map(t => ({ ...t, attachments: attachments.filter(a => a.templateId === t.id).map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })) }));
}
