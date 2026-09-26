import { NextRequest, NextResponse } from "next/server";
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, like, ne, or, sql } from "drizzle-orm";
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

function presenceFilter(column: typeof companies.primaryEmail, value: string | null) {
  if (value === "with") return and(isNotNull(column), ne(column, ""));
  if (value === "without") return or(isNull(column), eq(column, ""));
  return undefined;
}

export async function GET(request: NextRequest) {
  const db = getDb();
  const owner = ownerId(request);
  const params = request.nextUrl.searchParams;
  const search = params.get("search")?.trim();
  const limitParam = params.get("limit");
  const requestedLimit = limitParam === null ? NaN : Number(limitParam);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : undefined;

  // Mantém compatibilidade com consumidores leves já existentes (dashboard,
  // autocomplete etc.). A tela Empresas usa explicitamente mode=page.
  const paginated = params.get("mode") === "page";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize")) || 50));
  const region = Number(params.get("region"));
  const city = params.get("city")?.trim();
  const email = params.get("email");
  const phone = params.get("phone");
  const mobile = params.get("mobile");
  const companySize = params.get("companySize")?.trim();

  const searchCondition = search
    ? or(
        ilike(companies.name, `%${search}%`),
        ilike(companies.tradeName, `%${search}%`),
        search.replace(/\D/g, "")
          ? like(companies.cnpj, `%${search.replace(/\D/g, "")}%`)
          : undefined,
        ilike(companies.primaryEmail, `%${search}%`),
        ilike(companies.segment, `%${search}%`),
      )
    : undefined;

  const condition = and(
    eq(companies.ownerId, owner),
    searchCondition,
    Number.isInteger(region) && region >= 1 && region <= 17 ? eq(companies.region, region) : undefined,
    city ? eq(companies.city, city) : undefined,
    presenceFilter(companies.primaryEmail, email),
    presenceFilter(companies.phone, phone),
    presenceFilter(companies.mobile, mobile),
    companySize && companySize !== "all" ? eq(companies.companySize, companySize) : undefined,
  );

  if (!paginated) {
    const query = db
      .select()
      .from(companies)
      .where(condition)
      .orderBy(desc(companies.createdAt));
    return NextResponse.json(limit ? await query.limit(limit) : await query);
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(companies)
    .where(condition);

  const totalNumber = Number(total || 0);
  const totalPages = Math.max(1, Math.ceil(totalNumber / pageSize));
  const safePage = Math.min(page, totalPages);

  const items = await db
    .select()
    .from(companies)
    .where(condition)
    .orderBy(desc(companies.createdAt))
    .limit(pageSize)
    .offset((safePage - 1) * pageSize);

  // As cidades são uma faceta da região, não da página atual. Assim o filtro
  // continua completo mesmo carregando apenas 50 empresas no navegador.
  const cityCondition = and(
    eq(companies.ownerId, owner),
    Number.isInteger(region) && region >= 1 && region <= 17 ? eq(companies.region, region) : undefined,
    isNotNull(companies.city),
    ne(companies.city, ""),
  );
  const cityRows = Number.isInteger(region) && region >= 1 && region <= 17
    ? await db
        .selectDistinct({ city: companies.city })
        .from(companies)
        .where(cityCondition)
        .orderBy(asc(companies.city))
    : [];

  return NextResponse.json({
    items,
    page: safePage,
    pageSize,
    total: totalNumber,
    totalPages,
    cities: cityRows.map((row) => row.city).filter(Boolean),
  });
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
