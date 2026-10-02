import { SendFailure, databaseFailure } from "./send-diagnostics";
import { and, eq, inArray, isNull, lte, asc, notInArray } from "drizzle-orm";
import { getDb } from "@/db";
import { templateAttachments } from "@/db/schema";
import { ATTACHMENT_LIMITS, AttachmentError, attachmentIds, validateAttachmentSet, type Attachment } from "./attachments";
import { attachmentStorage } from "./attachment-storage";
export type AttachmentRow = typeof templateAttachments.$inferSelect;
export type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export const attachmentMetadata = ({ id, name, mimeType, size }: AttachmentRow): Attachment => ({ id, name, mimeType, size });
const sameTemplateId = (rowTemplateId: number | string | null, templateId?: number) =>
  rowTemplateId !== null && templateId !== undefined && Number(rowTemplateId) === Number(templateId);
export async function selectAttachments(tx: Transaction, owner: string, ids: string[], templateId?: number) {
  attachmentIds(ids);
  if (!ids.length) return [];
  const rows = await tx.select().from(templateAttachments).where(and(eq(templateAttachments.ownerId, owner), inArray(templateAttachments.id, ids))).orderBy(asc(templateAttachments.id)).for("update");
  if (rows.length !== ids.length || rows.some(row => !row.ready || (row.templateId !== null ? !sameTemplateId(row.templateId, templateId) : row.expiresAt.getTime() <= Date.now()))) throw new AttachmentError("Um anexo não está disponível. Adicione o arquivo novamente.");
  validateAttachmentSet(rows);
  return ids.map(id => rows.find(row => row.id === id)!);
}
export async function syncTemplateAttachments(tx: Transaction, owner: string, templateId: number, ids: string[]) {
  await selectAttachments(tx, owner, ids, templateId);
  const now = new Date();
  const currentFilter = and(eq(templateAttachments.ownerId, owner), eq(templateAttachments.templateId, templateId));

  // Desvincule somente arquivos realmente removidos. Os anexos mantidos não devem
  // passar por um estado temporário expirado durante cada salvamento do template.
  if (ids.length) {
    await tx.update(templateAttachments)
      .set({ templateId: null, expiresAt: now })
      .where(and(currentFilter, notInArray(templateAttachments.id, ids)));
    await tx.update(templateAttachments)
      .set({ templateId, expiresAt: new Date(now.getTime() + ATTACHMENT_LIMITS.draftHours * 3600_000) })
      .where(and(eq(templateAttachments.ownerId, owner), inArray(templateAttachments.id, ids)));
  } else {
    await tx.update(templateAttachments).set({ templateId: null, expiresAt: now }).where(currentFilter);
  }

  // Retorne o estado efetivamente persistido, e não o snapshot anterior ao UPDATE.
  const persisted = ids.length
    ? await tx.select().from(templateAttachments).where(and(eq(templateAttachments.ownerId, owner), eq(templateAttachments.templateId, templateId), inArray(templateAttachments.id, ids)))
    : [];
  if (persisted.length !== ids.length) throw new AttachmentError("Não foi possível vincular todos os anexos ao template.");
  const byId = new Map(persisted.map(row => [row.id, row]));
  return ids.map(id => attachmentMetadata(byId.get(id)!));
}
export async function loadSendAttachments(owner: string, value: unknown, templateId?: number) {
  // Explicitly empty selections must not allocate another database connection.
  if (!(value === undefined && templateId)) {
    const ids = attachmentIds(value ?? []);
    if (!ids.length) return [];
  }
  try { return await getDb().transaction(async tx => {
    const ids = value === undefined && templateId
      ? (await tx.select({ id: templateAttachments.id }).from(templateAttachments).where(and(eq(templateAttachments.ownerId, owner), eq(templateAttachments.templateId, templateId)))).map(row => row.id)
      : attachmentIds(value ?? []);
    const rows = await selectAttachments(tx, owner, ids, templateId);
    if (!rows.length) return [];
    const storage = attachmentStorage(), result = [];
    // Locks prevent cleanup from removing an object while it is being downloaded.
    for (const row of rows) {
      const content = await storage.get(row.storageKey);
      if (content.byteLength !== row.size) throw new AttachmentError("O tamanho de um anexo não confere. Adicione-o novamente.");
      result.push({ ...attachmentMetadata(row), content });
    }
    return result;
  }); } catch (error) {
    if (error instanceof AttachmentError || error instanceof SendFailure) throw error;
    throw databaseFailure(error);
  }
}
export async function cleanupAttachments() {
  const storage = attachmentStorage();
  return getDb().transaction(async tx => {
    const expired = await tx.select().from(templateAttachments).where(and(isNull(templateAttachments.templateId), lte(templateAttachments.expiresAt, new Date()))).orderBy(asc(templateAttachments.id)).limit(25).for("update", { skipLocked: true });
    let deleted = 0;
    for (const row of expired) {
      try {
        await storage.remove(row.storageKey);
        await tx.delete(templateAttachments).where(eq(templateAttachments.id, row.id));
        deleted++;
      } catch { /* Keep the record for a later retry. */ }
    }
    return { deleted, pending: expired.length - deleted };
  });
}

export async function copyTemplateAttachments(owner: string, sourceId: number) {
  const source = await loadSendAttachments(owner, undefined, sourceId);
  if (!source.length) return [];
  const db = getDb(), storage = attachmentStorage(), ids: string[] = [];
  for (const file of source) {
    const id = crypto.randomUUID(), now = new Date(), storageKey = "attachments/" + id;
    await db.insert(templateAttachments).values({
      id, ownerId: owner, name: file.name, mimeType: file.mimeType, size: file.size, storageKey,
      createdAt: now, expiresAt: new Date(now.getTime() + ATTACHMENT_LIMITS.draftHours * 3600_000),
    });
    await storage.put(storageKey, new Blob([new Uint8Array(file.content)], { type: file.mimeType }));
    await db.update(templateAttachments).set({ ready: true }).where(eq(templateAttachments.id, id));
    ids.push(id);
  }
  return ids;
}
