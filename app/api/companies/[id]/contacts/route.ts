import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, companies, contacts } from "@/db/schema";

type ContactInput = { id?: number; name?: string; email?: string; phone?: string; role?: string; isPrimary?: boolean };

const ownerId = (request: NextRequest) => "local-preview-user";

async function ownedCompany(request: NextRequest, id: number) {
  const db = getDb();
  const [company] = await db.select().from(companies).where(and(eq(companies.id, id), eq(companies.ownerId, ownerId(request)))).limit(1);
  return company;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const db = getDb(); const companyId = Number((await context.params).id); const body = await request.json() as ContactInput;
  const company = await ownedCompany(request, companyId);
  if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
  if (!body.name?.trim() && !body.email?.trim()) return NextResponse.json({ error: "Informe ao menos o nome ou e-mail do contato." }, { status: 400 });
  const now = new Date(); const primary = Boolean(body.isPrimary);
  if (primary) await db.update(contacts).set({ isPrimary: false }).where(eq(contacts.companyId, companyId));
  const [contact] = await db.insert(contacts).values({ companyId, name: body.name?.trim() || null, email: body.email?.trim().toLowerCase() || null, phone: body.phone?.trim() || null, role: body.role?.trim() || null, isPrimary: primary, createdAt: now }).returning();
  await db.insert(activityLogs).values({ ownerId: ownerId(request), companyId, type: "CONTACT_CREATED", description: `Contato ${contact.name || contact.email} adicionado`, createdAt: now });
  return NextResponse.json(contact, { status: 201 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const db = getDb(); const companyId = Number((await context.params).id); const body = await request.json() as ContactInput; const contactId = Number(body.id);
  const company = await ownedCompany(request, companyId);
  if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
  const [existing] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId))).limit(1);
  if (!existing) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
  if (!body.name?.trim() && !body.email?.trim()) return NextResponse.json({ error: "Informe ao menos o nome ou e-mail do contato." }, { status: 400 });
  if (body.isPrimary) await db.update(contacts).set({ isPrimary: false }).where(eq(contacts.companyId, companyId));
  const [contact] = await db.update(contacts).set({ name: body.name?.trim() || null, email: body.email?.trim().toLowerCase() || null, phone: body.phone?.trim() || null, role: body.role?.trim() || null, isPrimary: Boolean(body.isPrimary) }).where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId))).returning();
  await db.insert(activityLogs).values({ ownerId: ownerId(request), companyId, type: "CONTACT_UPDATED", description: `Contato ${contact.name || contact.email} atualizado`, createdAt: new Date() });
  return NextResponse.json(contact);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const db = getDb(); const companyId = Number((await context.params).id); const contactId = Number(request.nextUrl.searchParams.get("contactId"));
  const company = await ownedCompany(request, companyId);
  if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
  const [existing] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId))).limit(1);
  if (!existing) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
  await db.delete(contacts).where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId)));
  await db.insert(activityLogs).values({ ownerId: ownerId(request), companyId, type: "CONTACT_DELETED", description: `Contato ${existing.name || existing.email} removido`, createdAt: new Date() });
  return NextResponse.json({ ok: true });
}
