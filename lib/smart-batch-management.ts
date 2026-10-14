import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { documentSendBatches as batches, documentSendItems as items } from '@/db/schema';
import type { Transaction } from './attachment-service';
import { SmartSendError } from './smart-send-policy';
import { smartDeletionLimit, smartStorage } from './smart-send-storage';

export type DeletionChoice = { id: number; revision: number; documents: number };
export type DeletionResult = DeletionChoice & { name: string; eligible: boolean; reason: string | null; state: 'blocked' | 'eligible' | 'pending' | 'deleted' };
const owned = (owner: string, id: number) => and(eq(batches.ownerId, owner), eq(batches.id, id));

// Same lock is acquired BEFORE the parent lock in upload reservation/recovery.
export async function lockBatchImports(tx: Transaction, owner: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`smart-batch-management:${owner}`}, 0))`);
}

export async function listSmartBatches(owner: string, input: { search: string; status: string; oldest: boolean; page: number }) {
  const order = input.oldest ? asc : desc;
  const rows = await getDb().select({ id: batches.id, name: batches.name, status: batches.status, createdAt: batches.createdAt,
    deletionRequestedAt: batches.deletionRequestedAt, deletionError: batches.deletionError,
    documents: sql<number>`(select count(*)::int from document_send_items i where i.batch_id = document_send_batches.id and (i.removed_at is null or document_send_batches.deletion_requested_at is not null))`,
    pendingReview: sql<number>`(select count(*)::int from document_send_items i where i.batch_id = document_send_batches.id and i.removed_at is null and not i.excluded and i.review_status <> 'READY' and i.send_status = 'DRAFT')`,
    sent: sql<number>`(select count(*)::int from document_send_items i where i.batch_id = document_send_batches.id and i.send_status = 'SENT')`,
    pendingFiles: sql<number>`(select count(*)::int from document_send_items i where i.batch_id = document_send_batches.id and i.file_deleted_at is null)`,
  }).from(batches).where(and(eq(batches.ownerId, owner), isNull(batches.deletedAt),
    input.search ? ilike(batches.name, `%${input.search.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
    input.status === 'DELETING' ? sql`${batches.deletionRequestedAt} is not null` : and(isNull(batches.deletionRequestedAt), input.status ? eq(batches.status, input.status) : undefined)))
    .orderBy(order(batches.createdAt), order(batches.id)).limit(21).offset(input.page * 20);
  return { rows: rows.slice(0, 20).map(row => ({ ...row, id: Number(row.id) })), hasMore: rows.length > 20 };
}

async function inspect(tx: Transaction, owner: string, id: number): Promise<DeletionResult> {
  const [batch] = await tx.select().from(batches).where(owned(owner, id)).for('update');
  const base = { id, revision: batch?.revision || 0, documents: 0, name: batch?.name || 'Lote indisponível' };
  const blocked = (reason: string): DeletionResult => ({ ...base, eligible: false, reason, state: 'blocked' });
  if (!batch) return blocked('Lote não encontrado ou sem permissão.');
  if (batch.deletedAt) return { ...base, eligible: false, reason: null, state: 'deleted' };
  if (batch.deletionRequestedAt) return { ...base, eligible: false, reason: batch.deletionError, state: 'pending' };
  const rows = await tx.select().from(items).where(eq(items.batchId, id)).for('update');
  base.documents = rows.length;
  if (!['DRAFT', 'READY'].includes(batch.status) || batch.confirmedAt || batch.lockToken || batch.lockUntil || batch.nextRunAt || batch.completedAt)
    return blocked('O lote foi iniciado, cancelado ou possui evidência de processamento. Histórico preservado.');
  if (rows.some(i => i.ownerId !== owner || i.sendStatus !== 'DRAFT' || i.attempts !== 0 || i.infrastructureAttempts !== 0 || i.messageId || i.providerMessageId || i.processingAt || i.sentAt ||
    i.deliveryStatus !== 'PENDING' || i.deliveryError || i.bounceMessageId || i.deliveryCheckedAt || i.deliveryNextAt || i.deliveryPageToken || i.deliveryBefore || i.deliveryIncomplete || i.deliveryLockToken || i.deliveryLockUntil))
    return blocked('Há evidência de envio ou monitoramento em um documento. Histórico preservado.');
  if (rows.some(i => i.reviewStatus === 'UPLOADING' || i.importActiveAt)) return blocked('Existe importação ou recuperação pendente. Reconcilie a importação antes de excluir.');
  const reason = await externalReferences(tx, id, owner);
  if (reason) return blocked(reason);
  return { ...base, eligible: true, reason: null, state: 'eligible' };
}

async function externalReferences(tx: Transaction, id: number, owner: string) {
  const [result] = await tx.select({ blocked: sql<boolean>`
    exists (select 1 from document_send_items source join document_send_items other on other.duplicate_of = source.id where source.batch_id = ${id} and other.batch_id <> ${id})
    or exists (select 1 from document_send_items i where i.batch_id = ${id} and i.owner_id <> ${owner})
    or exists (select 1 from document_send_delivery_events e join document_send_items i on e.item_id = i.id where i.batch_id = ${id})
    or exists (select 1 from email_messages m join document_send_items i on m.rfc_message_id = i.rfc_message_id or m.id = i.message_id
      or m.attachments @> jsonb_build_array(jsonb_build_object('id', i.id)) where i.batch_id = ${id})
    or exists (select 1 from activity_logs a where a.description like ${`Envio Inteligente #${id} aceito pelo Gmail:%`} or a.description like ${`Devolução do Envio Inteligente #${id}:%`})
  ` }).from(batches).where(eq(batches.id, id));
  return result?.blocked ? 'Existem mensagens, auditoria, devoluções ou duplicatas em outro lote que precisam ser preservadas.' : null;
}

export async function previewBatchDeletion(owner: string, ids: number[]) {
  return getDb().transaction(async tx => {
    await lockBatchImports(tx, owner);
    const result: DeletionResult[] = [];
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) result.push(await inspect(tx, owner, id));
    return result;
  });
}

export async function requestBatchDeletion(owner: string, choices: DeletionChoice[]) {
  return getDb().transaction(async tx => {
    await lockBatchImports(tx, owner);
    const result: DeletionResult[] = [];
    for (const choice of [...choices].sort((a, b) => a.id - b.id)) {
      const check = await inspect(tx, owner, choice.id);
      if (!check.eligible) { result.push(check); continue; }
      if (check.revision !== choice.revision || check.documents !== choice.documents) {
        result.push({ ...check, eligible: false, state: 'blocked', reason: 'O lote mudou. Confira uma nova prévia antes de confirmar.' }); continue;
      }
      const now = new Date();
      await tx.update(batches).set({ status: 'CANCELLED', deletionRequestedAt: now, updatedAt: now, deletionError: null }).where(owned(owner, choice.id));
      await tx.update(items).set({ removedAt: now, excluded: true }).where(and(eq(items.batchId, choice.id), eq(items.ownerId, owner)));
      result.push({ ...check, eligible: false, state: 'pending' });
    }
    return result;
  });
}

export async function batchDeletionStatus(owner: string, id: number) {
  const [batch] = await getDb().select({ requestedAt: batches.deletionRequestedAt, deletedAt: batches.deletedAt, error: batches.deletionError,
    pendingFiles: sql<number>`(select count(*)::int from document_send_items i where i.batch_id = document_send_batches.id and i.file_deleted_at is null)` }).from(batches).where(owned(owner, id));
  if (!batch) throw new SmartSendError('Lote não encontrado.', 404);
  return { id, ...batch, state: batch.deletedAt ? 'deleted' : batch.requestedAt ? 'pending' : 'not-requested' };
}

export const DELETION_LEASE_MS = 60_000;
const deletionFailure = 'Não foi possível confirmar a remoção de todos os PDFs. A limpeza será retomada automaticamente.';
async function finishBatchDeletion(tx: Transaction, batch: typeof batches.$inferSelect) {
  await tx.delete(items).where(and(eq(items.batchId, batch.id), eq(items.ownerId, batch.ownerId)));
  await tx.update(batches).set({ name: 'Lote excluído', deletedAt: new Date(), deletionError: null, templateId: null, templateName: null,
    accountId: null, senderAddress: null, commonAttachments: [], notice: null, lockToken: null, lockUntil: null, updatedAt: new Date() }).where(owned(batch.ownerId, batch.id));
}

// Short claim/finalize transactions. No database lock or transaction spans Storage I/O.
// Existing lease columns are safe to reuse only on tombstoned, never-started batches.
export async function processBatchDeletion() {
  const db = getDb(), now = new Date(), token = 'delete:' + crypto.randomUUID();
  const claim = await db.transaction(async tx => {
    const [batch] = await tx.select().from(batches).where(and(sql`${batches.deletionRequestedAt} is not null`, isNull(batches.deletedAt),
      or(isNull(batches.lockUntil), lte(batches.lockUntil, now))))
      .orderBy(asc(batches.updatedAt), asc(batches.id)).limit(1).for('update', { skipLocked: true });
    if (!batch) return null;
    const reason = await externalReferences(tx, batch.id, batch.ownerId);
    if (reason) {
      await tx.update(batches).set({ deletionError: reason, updatedAt: new Date() }).where(eq(batches.id, batch.id));
      return { result: { deleted: 0, pending: true } };
    }
    const rows = await tx.select({ id: items.id, ownerId: items.ownerId, storageKey: items.storageKey, removedAt: items.removedAt,
      sendStatus: items.sendStatus, importActiveAt: items.importActiveAt }).from(items)
      .where(and(eq(items.batchId, batch.id), isNull(items.fileDeletedAt))).orderBy(asc(items.id)).limit(smartDeletionLimit());
    if (batch.status !== 'CANCELLED' || batch.confirmedAt || batch.completedAt || batch.nextRunAt || rows.some(row =>
      row.ownerId !== batch.ownerId || row.storageKey !== `smart-sends/${row.id}.pdf` || !row.removedAt || row.sendStatus !== 'DRAFT' || row.importActiveAt)) {
      await tx.update(batches).set({ deletionError: 'Estado do lote incompatível com a limpeza. Documentos preservados.', updatedAt: now }).where(eq(batches.id, batch.id));
      return { result: { deleted: 0, pending: true } };
    }
    if (!rows.length) { await finishBatchDeletion(tx, batch); return { result: { deleted: 0, pending: false } }; }
    await tx.update(batches).set({ lockToken: token, lockUntil: new Date(+now + DELETION_LEASE_MS), updatedAt: now }).where(owned(batch.ownerId, batch.id));
    return { batch, rows };
  });
  if (!claim) return null;
  if ('result' in claim) return claim.result;
  let confirmed: string[] = [];
  try { confirmed = await smartStorage().removeMany(claim.rows.map(row => row.storageKey)); }
  catch { /* Unknown outcome: retain records, retry the same keys after recovery. */ }
  return db.transaction(async tx => {
    const [batch] = await tx.select().from(batches).where(and(owned(claim.batch.ownerId, claim.batch.id), eq(batches.lockToken, token), isNull(batches.deletedAt))).for('update');
    if (!batch) return { deleted: 0, pending: true }; // A newer claim owns finalization.
    const ids = claim.rows.filter(row => confirmed.includes(row.storageKey)).map(row => row.id);
    if (ids.length) await tx.update(items).set({ fileDeletedAt: new Date(), fileReady: false }).where(and(eq(items.batchId, batch.id), eq(items.ownerId, batch.ownerId), inArray(items.id, ids), isNull(items.fileDeletedAt)));
    const [remaining] = await tx.select({ id: items.id }).from(items).where(and(eq(items.batchId, batch.id), isNull(items.fileDeletedAt))).limit(1);
    if (!remaining) { await finishBatchDeletion(tx, batch); return { deleted: ids.length, pending: false }; }
    await tx.update(batches).set({ lockToken: null, lockUntil: null, deletionError: ids.length === claim.rows.length ? null : deletionFailure, updatedAt: new Date() }).where(owned(batch.ownerId, batch.id));
    return { deleted: ids.length, pending: true };
  });
}
