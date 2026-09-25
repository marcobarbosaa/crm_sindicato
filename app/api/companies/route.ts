import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, like, or } from "drizzle-orm";
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

const ownerId = (request: NextRequest) => "local-preview-user";

export async function GET(request: NextRequest) {
  const db = getDb();
  const owner = ownerId(request);
  const search = request.nextUrl.searchParams.get("search")?.trim();
  const limitParam = request.nextUrl.searchParams.get("limit");
  const requestedLimit = limitParam === null ? NaN : Number(limitParam);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : undefined;
  const condition = search
    ? and(
        eq(companies.ownerId, owner),
        or(
          ilike(companies.name, `%${search}%`),
          ilike(companies.tradeName, `%${search}%`),
          search.replace(/\D/g, "") ? like(companies.cnpj, `%${search.replace(/\D/g, "")}%`) : undefined,
          ilike(companies.primaryEmail, `%${search}%`),
          ilike(companies.segment, `%${search}%`),
        ),
      )
    : eq(companies.ownerId, owner);

  const query = db
    .select()
    .from(companies)
    .where(condition)
    .orderBy(desc(companies.createdAt));

  return NextResponse.json(limit ? await query.limit(limit) : await query);
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const owner = ownerId(request);
  const body = (await request.json()) as Record<string, string | undefined>;
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
  const now = new Date();
  const workforce = parseWorkforce(body.employeeCount);
  const phone = normalizeBrazilianPhone(body.phone);
  const mobile = normalizeBrazilianPhone(body.mobile);
  try {
    const [company] = await db
      .insert(companies)
      .values({
        ownerId: owner,
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
        status: body.status || "NOT_CONTACTED",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (body.contactName?.trim() || body.contactEmail?.trim())
      await db.insert(contacts).values({
        companyId: company.id,
        name: body.contactName?.trim() || null,
        email: body.contactEmail?.trim().toLowerCase() || null,
        role: body.contactRole?.trim() || null,
        isPrimary: true,
        createdAt: now,
      });
    await db.insert(activityLogs).values({
      ownerId: owner,
      companyId: company.id,
      type: "COMPANY_CREATED",
      description: `Empresa ${company.name} cadastrada`,
      createdAt: now,
    });
    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    if (String(error).includes("UNIQUE"))
      return NextResponse.json(
        { error: "Já existe uma empresa com este CNPJ." },
        { status: 409 },
      );
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const db = getDb();
  const owner = ownerId(request);
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  await db
    .delete(companies)
    .where(and(eq(companies.id, id), eq(companies.ownerId, owner)));
  return NextResponse.json({ ok: true });
}
