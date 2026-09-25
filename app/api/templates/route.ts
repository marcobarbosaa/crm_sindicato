import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, emailTemplates, templateAttachments } from "@/db/schema";
import { AttachmentError, attachmentIds } from "@/lib/attachments";
import { attachmentMetadata, copyTemplateAttachments, syncTemplateAttachments } from "@/lib/attachment-service";
const owner = "local-preview-user";
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
export async function GET() {
  const db = getDb();
  const templates = await db.select().from(emailTemplates).where(eq(emailTemplates.ownerId, owner)).orderBy(desc(emailTemplates.updatedAt));
  const files = templates.length ? await db.select().from(templateAttachments).where(and(eq(templateAttachments.ownerId, owner), inArray(templateAttachments.templateId, templates.map(t => t.id)))) : [];
  return NextResponse.json(templates.map(t => ({ ...t, attachments: files.filter(f => f.templateId === t.id).map(attachmentMetadata) })));
}
async function save(request: NextRequest, id?: number) {
  try {
    const input = await request.json() as Record<string, unknown>;
    if (input.sourceId !== undefined && id === undefined) {
      if (!Number.isSafeInteger(input.sourceId) || Number(input.sourceId) <= 0) throw new AttachmentError("Template inválido.");
      const [source] = await getDb().select().from(emailTemplates).where(and(eq(emailTemplates.ownerId, owner), eq(emailTemplates.id, Number(input.sourceId)))).limit(1);
      if (!source) throw new AttachmentError("Template não encontrado.");
      input.name = source.name.slice(0, 92) + " — cópia"; input.subject = source.subject; input.body = source.body;
      input.attachmentIds = await copyTemplateAttachments(owner, source.id);
    }
    const name = clean(input.name), subject = clean(input.subject), body = clean(input.body);
    if (!name || !subject || !body) throw new AttachmentError("Preencha nome, assunto e mensagem.");
    if (name.length > 100 || subject.length > 200 || body.length > 20_000) throw new AttachmentError("Limites: nome de 100 caracteres, assunto de 200 e mensagem de 20.000.");
    const ids = input.attachmentIds === undefined ? undefined : attachmentIds(input.attachmentIds);
    const now = new Date();
    const template = await getDb().transaction(async tx => {
      if (id !== undefined) {
        const [existing] = await tx.select().from(emailTemplates).where(and(eq(emailTemplates.id, id), eq(emailTemplates.ownerId, owner))).for("update");
        if (!existing) throw new AttachmentError("Template não encontrado.");
      }
      const [row] = id === undefined
        ? await tx.insert(emailTemplates).values({ ownerId: owner, name, subject, body, createdAt: now, updatedAt: now }).returning()
        : await tx.update(emailTemplates).set({ name, subject, body, updatedAt: now }).where(and(eq(emailTemplates.id, id), eq(emailTemplates.ownerId, owner))).returning();
      const retained = ids ?? (await tx.select({ id: templateAttachments.id }).from(templateAttachments).where(and(eq(templateAttachments.ownerId, owner), eq(templateAttachments.templateId, row.id)))).map(f => f.id);
      const attachments = await syncTemplateAttachments(tx, owner, row.id, retained);
      await tx.insert(activityLogs).values({ ownerId: owner, type: id === undefined ? "TEMPLATE_CREATED" : "TEMPLATE_UPDATED", description: "Template " + name + (id === undefined ? " criado" : " atualizado"), createdAt: now });
      return { ...row, attachments };
    });
    return NextResponse.json(template, { status: id === undefined ? 201 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AttachmentError ? error.message : "Não foi possível salvar o template. Tente novamente." }, { status: error instanceof AttachmentError ? 400 : 503 });
  }
}
export async function POST(request: NextRequest) { return save(request); }
export async function PATCH(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Template inválido." }, { status: 400 });
  return save(request, id);
}
export async function DELETE(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Template inválido." }, { status: 400 });
  try {
    const removed = await getDb().transaction(async tx => {
      const [existing] = await tx.select().from(emailTemplates).where(and(eq(emailTemplates.id, id), eq(emailTemplates.ownerId, owner))).for("update");
      if (!existing) return false;
      await syncTemplateAttachments(tx, owner, id, []);
      await tx.delete(emailTemplates).where(eq(emailTemplates.id, id));
      await tx.insert(activityLogs).values({ ownerId: owner, type: "TEMPLATE_DELETED", description: "Template " + existing.name + " excluído", createdAt: new Date() });
      return true;
    });
    return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Não foi possível excluir o template." }, { status: 503 }); }
}
