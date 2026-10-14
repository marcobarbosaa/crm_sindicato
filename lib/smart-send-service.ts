import { and, asc, eq, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { companies, contacts, crmSettings, documentSendBatches as batches, documentSendItems as items, emailAccounts, emailTemplates, templateAttachments } from '@/db/schema';
import { type Transaction, selectAttachments, attachmentMetadata } from './attachment-service';
import { storageConfig } from './attachment-storage';
import { validateAttachmentSet } from './attachments';
import { SmartSendError, smartLimits, validateSmartFile, recipientReview, personalizeSmart } from './smart-send-policy';
import { contentHash, smartStorage } from './smart-send-storage';
import { extractCnpjs, matchPdfCompany, normalizeName } from './pdf-company-matcher';
import { GMAIL_SEND_SCOPE } from './gmail';
import { importResult, IMPORT_LEASE_MS } from './smart-import-protocol';
import { ownedBatch, ownedItems } from './smart-send-scope';
import { lockBatchImports, processBatchDeletion } from './smart-batch-management';

export { ownedBatch, ownedItems } from './smart-send-scope';
export { getSmartBatch, getSmartImportStatus, smartCatalog } from './smart-send-queries';

export async function requireBatch(owner: string, id: number, tx: Transaction) {
  const [batch] = await tx.select().from(batches).where(ownedBatch(owner, id)).for('update');
  if (!batch) throw new SmartSendError('Lote não encontrado.', 404);
  if (batch.deletionRequestedAt) throw new SmartSendError('Lote em exclusão ou já excluído.', 409);
  return batch;
}
function editable(batch: typeof batches.$inferSelect) {
  if (!['DRAFT', 'READY'].includes(batch.status)) throw new SmartSendError('A revisão deste lote já foi encerrada.', 409);
}
async function invalidate(tx: Transaction, owner: string, id: number) {
  await tx.update(batches).set({ status: 'DRAFT', revision: sql`${batches.revision} + 1`, updatedAt: new Date(), commonAttachments: [] }).where(ownedBatch(owner, id));
}
export async function uploadSmartPdf(owner: string, batchId: number, name: string, mime: string, bytes: Uint8Array, uploadId?: string, recover = false) {
  const limits = smartLimits(storageConfig); validateSmartFile({ name, type: mime, size: bytes.length }, limits);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new SmartSendError('Assinatura PDF inválida.');
  const hash = await contentHash(bytes), id = uploadId || crypto.randomUUID(), now = new Date(), db = getDb();
  const reservation = await db.transaction(async tx => {
    await lockBatchImports(tx, owner);
    const batch = await requireBatch(owner, batchId, tx); editable(batch);
    // Same content imported into different batches is serialized too.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner + ':' + hash}, 0))`);
    const [existing] = await tx.select().from(items).where(eq(items.id, id));
    if (existing) {
      if (existing.ownerId !== owner || existing.batchId !== batchId || existing.contentHash !== hash) throw new SmartSendError('Identificador de importação incompatível.', 409);
      if (!recover || !importResult(existing).recoverable || (existing.reviewStatus === 'UPLOADING' && +existing.updatedAt > Date.now() - IMPORT_LEASE_MS)) return { row: existing, process: false };
      const [claimed] = await tx.update(items).set({ reviewStatus: 'UPLOADING', importActiveAt: now, readable: false, confirmedAt: null, updatedAt: now }).where(eq(items.id, id)).returning();
      await invalidate(tx, owner, batchId);
      return { row: claimed, process: true };
    }
    if (recover) throw new SmartSendError('Registro de importação não encontrado. Reconcilie o lote.', 409);
    const [{ total }] = await tx.select({ total: sql<number>`count(*)` }).from(items).where(and(ownedItems(owner, batchId), isNull(items.removedAt)));
    if (Number(total) >= limits.batchFiles) throw new SmartSendError('Limite de documentos do lote atingido.');
    const [duplicate] = await tx.select({ id: items.id }).from(items).where(and(eq(items.ownerId, owner), eq(items.contentHash, hash), isNull(items.removedAt),
      or(isNull(items.fileDeletedAt), inArray(items.sendStatus, ['SENT', 'UNCERTAIN'])))).limit(1);
    const [item] = await tx.insert(items).values({ id, ownerId: owner, batchId, fileName: name, fileSize: bytes.length, contentHash: hash,
      storageKey: `smart-sends/${id}.pdf`, rfcMessageId: `<${id}@smart.prospecta.invalid>`, duplicateOf: duplicate?.id || null,
      reviewStatus: duplicate ? 'DUPLICATE' : 'UPLOADING', importActiveAt: duplicate ? null : now, error: duplicate ? 'Documento já importado ou enviado.' : null, createdAt: now, updatedAt: now }).returning();
    await invalidate(tx, owner, batchId); return { row: item, process: !item.duplicateOf };
  });
  const row = reservation.row;
  if (!reservation.process) return importResult(row);
  // updatedAt fences a slow original request after another request claims recovery.
  const lease = and(ownedItems(owner, batchId), eq(items.id, id), eq(items.updatedAt, now), eq(items.reviewStatus, 'UPLOADING'), isNull(items.removedAt));
  let stored = row.fileReady;
  try {
    if (recover) {
      try {
        const saved = await smartStorage().get(row.storageKey);
        if (await contentHash(saved) !== hash) throw new SmartSendError('Integridade do PDF inválida.', 409);
        stored = true;
      } catch (error) {
        if (!(error instanceof SmartSendError) || error.status !== 404) throw error;
        stored = false;
      }
    }
    if (!stored) await smartStorage().put(row.storageKey, bytes);
    stored = true;
    const persisted = await db.update(items).set({ fileReady: true }).where(lease).returning({ id: items.id });
    if (!persisted.length) throw new SmartSendError('A importação está sendo recuperada por outra requisição.', 409);
    const { readPdfText } = await import('./pdf-text');
    const reading = await readPdfText(bytes, limits), extracted = extractCnpjs(reading.text), cnpjs = extracted.map(c => c.cnpj);
    // Bounded owner-scoped lookup. Filename suggestions never imply approval.
    const words = normalizeName(name).split(' ').filter(w => w.length > 2).slice(0, 8);
    const candidates = await db.select().from(companies).where(and(eq(companies.ownerId, owner), cnpjs.length
      ? inArray(sql<string>`regexp_replace(${companies.cnpj}, '[^0-9]', '', 'g')`, cnpjs)
      : words.length ? or(...words.map(word => or(ilike(companies.name, `%${word}%`), ilike(companies.tradeName, `%${word}%`)))) : sql`false`)).limit(200);
    const match = matchPdfCompany(reading.text, name, candidates, extracted), company = candidates.find(c => c.id === match.companyId);
    await db.transaction(async tx => {
      const batch = await requireBatch(owner, batchId, tx); editable(batch);
      const changed = await tx.update(items).set({ fileReady: true, readable: reading.readable, extractedCnpjs: match.cnpjs, candidates: match.candidates,
        companyId: company?.id || null, companyName: company?.name || null, companyCnpj: company?.cnpj || null, recipient: company?.primaryEmail?.trim().toLowerCase() || null,
        identificationMethod: match.method, reviewStatus: !reading.readable ? 'READ_ERROR' : company ? recipientReview(company) : match.status,
        error: reading.error, importActiveAt: null, updatedAt: new Date() }).where(lease).returning({ id: items.id });
      if (!changed.length) throw new SmartSendError('A importação foi alterada. Reconcilie o lote.', 409);
      await invalidate(tx, owner, batchId);
    });
  } catch {
    // Preserve proven storage state; never delete a record/object to hide a failure.
    await db.update(items).set({ fileReady: stored, readable: false, reviewStatus: 'READ_ERROR', importActiveAt: null, error: stored ? 'IMPORT_ANALYSIS_FAILED' : 'IMPORT_STORAGE_FAILED', updatedAt: new Date() }).where(lease);
  }
  const [finished] = await db.select().from(items).where(and(ownedItems(owner, batchId), eq(items.id, id)));
  return importResult(finished);
}
export async function reviewSmartItem(owner: string, batchId: number, id: string, input: { companyId?: number; confirm?: boolean; excluded?: boolean; remove?: boolean }) {
  return getDb().transaction(async tx => {
    editable(await requireBatch(owner, batchId, tx));
    const [item] = await tx.select().from(items).where(and(ownedItems(owner, batchId), eq(items.id, id), isNull(items.removedAt))).for('update');
    if (!item) throw new SmartSendError('Documento não encontrado.', 404);
    if (item.importActiveAt || item.reviewStatus === 'UPLOADING') throw new SmartSendError('Aguarde ou reconcilie a importação antes de alterar o documento.', 409);
    if (input.remove) await tx.update(items).set({ removedAt: new Date(), excluded: true, confirmedAt: null }).where(eq(items.id, id));
    else {
      const companyId = input.companyId ?? item.companyId;
      const [company] = companyId ? await tx.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.ownerId, owner))) : [];
      if (input.companyId && !company) throw new SmartSendError('Empresa não encontrada.', 404);
      const status = item.duplicateOf ? 'DUPLICATE' : !item.fileReady || !item.readable || item.fileDeletedAt ? 'READ_ERROR' : recipientReview(company);
      if (input.confirm && status !== 'IDENTIFIED') throw new SmartSendError('Documento ou destinatário bloqueado.');
      await tx.update(items).set({ companyId: company?.id || null, companyName: company?.name || null, companyCnpj: company?.cnpj || null,
        recipient: company?.primaryEmail?.trim().toLowerCase() || null, identificationMethod: input.companyId ? 'MANUAL' : item.identificationMethod,
        reviewStatus: input.confirm ? 'READY' : status, confirmedAt: input.confirm ? new Date() : null, excluded: input.excluded ?? item.excluded, updatedAt: new Date() }).where(eq(items.id, id));
    }
    await invalidate(tx, owner, batchId);
  });
}
export async function prepareSmartBatch(owner: string, id: number, templateId: number, includeCommon: boolean) {
  return getDb().transaction(async tx => {
    editable(await requireBatch(owner, id, tx));
    const [template] = await tx.select().from(emailTemplates).where(and(eq(emailTemplates.id, templateId), eq(emailTemplates.ownerId, owner))).for('share');
    if (!template) throw new SmartSendError('Template não encontrado.');
    const [settings] = await tx.select().from(crmSettings).where(eq(crmSettings.ownerId, owner));
    const [account] = await tx.select().from(emailAccounts).where(and(eq(emailAccounts.ownerId, owner), eq(emailAccounts.provider, 'GMAIL')));
    if (!account || account.needsReconnect || !account.scopes.split(/\s+/).includes(GMAIL_SEND_SCOPE)) throw new SmartSendError('Conecte ou reconecte o Gmail em Configurações.', 409);
    const ids = includeCommon ? (await tx.select({ id: templateAttachments.id }).from(templateAttachments).where(and(eq(templateAttachments.ownerId, owner), eq(templateAttachments.templateId, templateId)))).map(a => a.id) : [];
    const common = await selectAttachments(tx, owner, ids, templateId);
    const rows = await tx.select().from(items).where(and(ownedItems(owner, id), isNull(items.removedAt)));
    if (rows.some(r => r.reviewStatus === 'UPLOADING')) throw new SmartSendError('Aguarde todos os uploads e análises.');
    const companyIds = [...new Set(rows.filter(r => !r.excluded && r.reviewStatus === 'READY' && r.companyId).map(r => r.companyId!))];
    const companyRows = companyIds.length ? await tx.select().from(companies).where(and(eq(companies.ownerId, owner), inArray(companies.id, companyIds))).for('share') : [];
    const contactRows = companyIds.length ? await tx.select().from(contacts).where(and(inArray(contacts.companyId, companyIds), eq(contacts.isPrimary, true))).orderBy(asc(contacts.id)) : [];
    const snapshots: { id: string; subject: string; body: string; company_name: string; company_cnpj: string | null }[] = [];
    for (const row of rows) {
      if (row.excluded || row.reviewStatus !== 'READY' || !row.confirmedAt) continue;
      const company = companyRows.find(c => Number(c.id) === Number(row.companyId));
      if (!company || recipientReview(company) !== 'IDENTIFIED' || company.primaryEmail?.trim().toLowerCase() !== row.recipient || !row.fileReady || !row.readable || row.fileDeletedAt || row.duplicateOf) throw new SmartSendError(`Revise novamente: ${row.fileName}.`, 409);
      validateAttachmentSet([{ size: row.fileSize }, ...common]);
      const contact = contactRows.find(c => Number(c.companyId) === Number(company.id));
      const data = { empresa: company.name, contato: contact?.name || '', cidade: company.city || '', estado: company.state || '', segmento: company.segment || '', email_empresa: row.recipient || '' };
      const subject = personalizeSmart(template.subject, data), message = personalizeSmart(template.body, data), body = message + (settings?.signature ? '\n\n' + settings.signature : '');
      snapshots.push({ id: row.id, subject, body, company_name: company.name, company_cnpj: company.cnpj });
    }
    if (!snapshots.length) throw new SmartSendError('Confirme pelo menos uma associação válida.');
    await tx.execute(sql`update document_send_items i set subject = s.subject, body = s.body, company_name = s.company_name, company_cnpj = s.company_cnpj, updated_at = ${Date.now()}
      from jsonb_to_recordset(${JSON.stringify(snapshots)}::jsonb) as s(id text, subject text, body text, company_name text, company_cnpj text)
      where i.id = s.id and i.owner_id = ${owner} and i.batch_id = ${id}`);
    await tx.update(batches).set({ status: 'READY', templateId, templateName: template.name, senderAddress: account.email.trim().toLowerCase(), accountId: account.id,
      commonAttachments: common.map(attachmentMetadata), revision: sql`${batches.revision} + 1`, updatedAt: new Date() }).where(ownedBatch(owner, id));
  });
}
export async function controlSmartBatch(owner: string, id: number, action: string, revision?: number, confirmed?: boolean) {
  return getDb().transaction(async tx => {
    const batch = await requireBatch(owner, id, tx), now = new Date();
    if (action === 'start') {
      if (!confirmed || batch.status !== 'READY' || revision !== batch.revision) throw new SmartSendError('Revise o lote atualizado e confirme explicitamente.', 409);
      await tx.update(items).set({ sendStatus: sql`case when not ${items.excluded} and ${items.reviewStatus} = 'READY' and ${items.confirmedAt} is not null then 'PENDING' else 'SKIPPED' end`, updatedAt: now }).where(and(ownedItems(owner, id), isNull(items.removedAt)));
      await tx.update(batches).set({ status: 'RUNNING', confirmedAt: now, nextRunAt: now, updatedAt: now }).where(ownedBatch(owner, id));
    } else if (action === 'pause' && batch.status === 'RUNNING') await tx.update(batches).set({ status: 'PAUSED', updatedAt: now }).where(ownedBatch(owner, id));
    else if (action === 'resume' && batch.status === 'PAUSED') {
      const unresolved = await tx.select({ id: items.id }).from(items).where(and(ownedItems(owner, id), inArray(items.sendStatus, ['PROCESSING', 'UNCERTAIN']))).limit(1);
      if (unresolved.length) throw new SmartSendError('Aguarde a recuperação ou encerre os itens incertos sem reenviar.', 409);
      await tx.update(batches).set({ status: 'RUNNING', notice: null, nextRunAt: batch.nextRunAt && batch.nextRunAt > now ? batch.nextRunAt : now, updatedAt: now }).where(ownedBatch(owner, id));
    } else if (action === 'cancel' && !['COMPLETED', 'CANCELLED'].includes(batch.status)) {
      await tx.update(items).set({ sendStatus: 'SKIPPED', updatedAt: now }).where(and(ownedItems(owner, id), inArray(items.sendStatus, ['PENDING', 'DRAFT'])));
      await tx.update(batches).set({ status: 'CANCELLED', completedAt: now, nextRunAt: null, updatedAt: now }).where(ownedBatch(owner, id));
    } else throw new SmartSendError('Ação incompatível com o estado atual.', 409);
  });
}
export async function cleanupSmartFiles(scheduledTime = Date.now()) {
  // Alternate opportunities, never add deletion work to a retention chunk.
  if (Math.floor(scheduledTime / (8 * 60_000)) % 2 === 0) {
    const deletion = await processBatchDeletion();
    if (deletion) return deletion;
  }
  const db = getDb(), limits = smartLimits(storageConfig), now = Date.now();
  return db.transaction(async tx => {
    // Lock parent first, matching upload/review/confirmation and preventing retention races.
    const candidates = await tx.select().from(batches).where(and(isNull(batches.deletionRequestedAt), sql`exists (select 1 from ${items} where ${items.batchId} = ${batches.id} and ${items.fileDeletedAt} is null and ${items.sendStatus} not in ('PROCESSING','PENDING','UNCERTAIN'))`, or(
      and(inArray(batches.status, ['DRAFT', 'READY']), lte(batches.updatedAt, new Date(now - limits.draftHours * 3600_000))),
      and(inArray(batches.status, ['COMPLETED', 'CANCELLED']), or(lte(batches.completedAt, new Date(now - limits.retentionDays * 86400_000)), eq(batches.notice, 'Rascunho expirado; documentos removidos.'))),
      sql`exists (select 1 from ${items} where ${items.batchId} = ${batches.id} and ${items.removedAt} is not null and ${items.fileDeletedAt} is null)`
    ))).orderBy(asc(batches.updatedAt)).limit(1).for('update', { skipLocked: true });
    if (!candidates.length) return { deleted: 0 };
    const batch = candidates[0], abandon = ['DRAFT', 'READY'].includes(batch.status) && +batch.updatedAt <= now - limits.draftHours * 3600_000;
    if (abandon) await tx.update(batches).set({ status: 'CANCELLED', completedAt: new Date(), notice: 'Rascunho expirado; documentos removidos.', updatedAt: new Date() }).where(eq(batches.id, batch.id));
    const all = abandon || batch.notice === 'Rascunho expirado; documentos removidos.' || (['COMPLETED', 'CANCELLED'].includes(batch.status) && +(batch.completedAt || 0) <= now - limits.retentionDays * 86400_000);
    const expired = await tx.select().from(items).where(and(ownedItems(batch.ownerId, batch.id), isNull(items.fileDeletedAt), all ? undefined : and(sql`${items.removedAt} is not null`, lte(items.updatedAt, new Date(now - 10 * 60_000))),
      sql`${items.sendStatus} not in ('PROCESSING','PENDING','UNCERTAIN')`)).limit(5).for('update', { skipLocked: true });
    let deleted = 0;
    for (const row of expired) {
      try { await smartStorage().remove(row.storageKey); await tx.update(items).set({ fileDeletedAt: new Date(), fileReady: false }).where(eq(items.id, row.id)); deleted++; }
      catch { /* Tracked metadata survives for next scheduled retry. */ }
    }
    return { deleted };
  });
}
