import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, emailTemplates } from "@/db/schema";

type TemplateInput = { name?:string; subject?:string; body?:string; sourceId?:number };
const ownerId = (request: NextRequest) => "local-preview-user";
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function GET(request: NextRequest) {
  const db = getDb(); const owner = ownerId(request);
  return NextResponse.json(await db.select().from(emailTemplates).where(eq(emailTemplates.ownerId, owner)).orderBy(desc(emailTemplates.updatedAt)));
}

export async function POST(request: NextRequest) {
  const db = getDb(); const owner = ownerId(request); const input = await request.json() as TemplateInput; const now = new Date();
  let name = clean(input.name), subject = clean(input.subject), body = clean(input.body);
  if (input.sourceId) {
    const [source] = await db.select().from(emailTemplates).where(and(eq(emailTemplates.id, Number(input.sourceId)), eq(emailTemplates.ownerId, owner))).limit(1);
    if (!source) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    name = `${source.name} — cópia`; subject = source.subject; body = source.body;
  }
  const error = validate(name, subject, body); if (error) return NextResponse.json({ error }, { status: 400 });
  const [template] = await db.insert(emailTemplates).values({ ownerId: owner, name, subject, body, createdAt: now, updatedAt: now }).returning();
  await db.insert(activityLogs).values({ ownerId: owner, companyId: null, type: "TEMPLATE_CREATED", description: `Template ${template.name} criado`, createdAt: now });
  return NextResponse.json(template, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const db = getDb(); const owner = ownerId(request); const id = Number(request.nextUrl.searchParams.get("id")); const input = await request.json() as TemplateInput;
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Template inválido." }, { status: 400 });
  const name = clean(input.name), subject = clean(input.subject), body = clean(input.body); const error = validate(name, subject, body); if (error) return NextResponse.json({ error }, { status: 400 });
  const [template] = await db.update(emailTemplates).set({ name, subject, body, updatedAt: new Date() }).where(and(eq(emailTemplates.id, id), eq(emailTemplates.ownerId, owner))).returning();
  if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  await db.insert(activityLogs).values({ ownerId: owner, companyId: null, type: "TEMPLATE_UPDATED", description: `Template ${template.name} atualizado`, createdAt: new Date() });
  return NextResponse.json(template);
}

export async function DELETE(request: NextRequest) {
  const db = getDb(); const owner = ownerId(request); const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Template inválido." }, { status: 400 });
  const [removed] = await db.delete(emailTemplates).where(and(eq(emailTemplates.id, id), eq(emailTemplates.ownerId, owner))).returning();
  if (!removed) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  await db.insert(activityLogs).values({ ownerId: owner, companyId: null, type: "TEMPLATE_DELETED", description: `Template ${removed.name} excluído`, createdAt: new Date() });
  return NextResponse.json({ ok: true });
}

function validate(name:string, subject:string, body:string) {
  if (!name) return "Informe um nome para identificar o template.";
  if (!subject) return "Informe o assunto do e-mail.";
  if (!body) return "Escreva o conteúdo do e-mail.";
  if (name.length > 100) return "O nome deve ter no máximo 100 caracteres.";
  if (subject.length > 200) return "O assunto deve ter no máximo 200 caracteres.";
  if (body.length > 20_000) return "O conteúdo deve ter no máximo 20.000 caracteres.";
  return null;
}
