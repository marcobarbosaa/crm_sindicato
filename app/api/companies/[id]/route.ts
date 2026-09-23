import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, companies, contacts } from "@/db/schema";
import {
  isValidCnpj,
  isValidEmployeeCount,
  normalizeCnpj,
  parseWorkforce,
} from "@/lib/company-size";
import { normalizeBrazilianPhone, normalizeWhatsAppStatus } from "@/lib/phone";
import { isValidRegion, parseRegion } from "@/lib/region";

const ownerId = (request: NextRequest) =>
  "local-preview-user";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const db = getDb();
  const owner = ownerId(request);
  const id = Number((await context.params).id);
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  const [company] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, id), eq(companies.ownerId, owner)))
    .limit(1);
  if (!company)
    return NextResponse.json(
      { error: "Empresa não encontrada." },
      { status: 404 },
    );
  const [companyContacts, activities] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(eq(contacts.companyId, id))
      .orderBy(desc(contacts.isPrimary), desc(contacts.createdAt)),
    db
      .select()
      .from(activityLogs)
      .where(
        and(eq(activityLogs.companyId, id), eq(activityLogs.ownerId, owner)),
      )
      .orderBy(desc(activityLogs.createdAt))
      .limit(50),
  ]);
  return NextResponse.json({ company, contacts: companyContacts, activities });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const db = getDb();
  const owner = ownerId(request);
  const id = Number((await context.params).id);
  const body = (await request.json()) as Record<string, string | undefined>;
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  if (!body.name?.trim())
    return NextResponse.json(
      { error: "Informe o nome fantasia." },
      { status: 400 },
    );
  if (!isValidCnpj(body.cnpj))
    return NextResponse.json(
      { error: "O CNPJ deve conter 14 dígitos." },
      { status: 400 },
    );
  if (!isValidEmployeeCount(body.employeeCount))
    return NextResponse.json(
      {
        error:
          "Informe um número ou uma faixa válida no quadro de funcionários.",
      },
      { status: 400 },
    );
  if (!isValidRegion(body.region))
    return NextResponse.json(
      { error: "A região deve ser um número de 1 a 17." },
      { status: 400 },
    );
  const [existing] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, id), eq(companies.ownerId, owner)))
    .limit(1);
  if (!existing)
    return NextResponse.json(
      { error: "Empresa não encontrada." },
      { status: 404 },
    );
  const now = new Date();
  const workforce = parseWorkforce(body.employeeCount);
  const phone = normalizeBrazilianPhone(body.phone);
  const mobile = normalizeBrazilianPhone(body.mobile);
  try {
    const [updated] = await db
      .update(companies)
      .set({
        name: body.name.trim(),
        tradeName: body.tradeName?.trim() || null,
        cnpj: normalizeCnpj(body.cnpj),
        website: body.website?.trim() || null,
        segment: body.segment?.trim() || null,
        region: parseRegion(body.region),
        address: body.address?.trim() || null,
        city: body.city?.trim() || null,
        state: body.state?.trim()?.toUpperCase() || null,
        phone,
        phoneWhatsAppStatus: phone
          ? normalizeWhatsAppStatus(body.phoneWhatsAppStatus)
          : "UNKNOWN",
        mobile,
        mobileWhatsAppStatus: mobile
          ? normalizeWhatsAppStatus(body.mobileWhatsAppStatus)
          : "UNKNOWN",
        primaryEmail: body.primaryEmail?.trim().toLowerCase() || null,
        employeeCount: workforce.employeeCount,
        employeeRange: workforce.employeeRange,
        companySize: workforce.companySize,
        notes: body.notes?.trim() || null,
        status: body.status || existing.status,
        updatedAt: now,
      })
      .where(and(eq(companies.id, id), eq(companies.ownerId, owner)))
      .returning();
    const statusChanged = existing.status !== updated.status;
    await db.insert(activityLogs).values({
      ownerId: owner,
      companyId: id,
      type: statusChanged ? "STATUS_CHANGED" : "COMPANY_UPDATED",
      description: statusChanged
        ? `Status alterado para ${body.statusLabel || updated.status}`
        : "Dados da empresa atualizados",
      createdAt: now,
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      return NextResponse.json(
        { error: "Já existe uma empresa com este CNPJ." },
        { status: 409 },
      );
    throw error;
  }
}
