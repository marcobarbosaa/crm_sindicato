import { and, eq, inArray, isNull, lte, asc } from "drizzle-orm";
import { getDb } from "@/db";
import { templateAttachments } from "@/db/schema";
import { ATTACHMENT_LIMITS, AttachmentError, attachmentIds, validateAttachmentSet, type Attachment } from "./attachments";
import { attachmentStorage } from "./attachment-storage";
export type AttachmentRow = typeof templateAttachments.$inferSelect;
export type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export const attachmentMetadata = ({ id, name, mimeType, size }: AttachmentRow): Attachment => ({ id, name, mimeType, size });
export async function selectAttachments(tx: Transaction, owner: string, ids: string[], templateId?: number) {
  attachmentIds(ids);
  if (!ids.length) return [];
  const rows = await tx.select().from(templateAttachments).where(and(eq(templateAttachments.ownerId, owner), inArray(templateAttachments.id, ids))).orderBy(asc(templateAttachments.id)).for("update");
  if (rows.length !== ids.length || rows.some(row => !row.ready || (row.templateId !== null ? row.templateId !== templateId : row.expiresAt.getTime() <= Date.now()))) throw new AttachmentError("Um anexo não está disponível. Adicione o arquivo novamente.");
  validateAttachmentSet(rows);
  return ids.map(id => rows.find(row => row.id === id)!);
}
export async function syncTemplateAttachments(tx: Transaction, owner: string, templateId: number, ids: string[]) {
  const rows = await selectAttachments(tx, owner, ids, templateId);
  // Keep detached objects tracked until cleanup successfully deletes them.
  await tx.update(templateAttachments).set({ templateId: null, expiresAt: new Date() }).where(and(eq(templateAttachments.ownerId, owner), eq(templateAttachments.templateId, templateId)));
  if (ids.length) await tx.update(templateAttachments).set({ templateId }).where(and(eq(templateAttachments.ownerId, owner), inArray(templateAttachments.id, ids)));
  return rows.map(attachmentMetadata);
}
export async function loadSendAttachments(owner: string, value: unknown, templateId?: number) {
  return getDb().transaction(async tx => {
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
  });
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
