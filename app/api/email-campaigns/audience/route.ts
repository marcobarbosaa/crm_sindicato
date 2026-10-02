import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { companies, contacts } from "@/db/schema";
import { audienceKnownInvalid, audienceRecipient, primaryContactId } from "@/lib/campaign-audience";

const ownerId = () => "local-preview-user";

function validRegion(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 17;
}

export async function GET(request: NextRequest) {
  const db = getDb();
  const owner = ownerId();
  const params = request.nextUrl.searchParams;

  const region = Number(params.get("region"));
  const city = params.get("city")?.trim();
  const companySize = params.get("companySize")?.trim();
  const companyStatus = params.get("status")?.trim();

  const condition = and(
    eq(companies.ownerId, owner),
    validRegion(region) ? eq(companies.region, region) : undefined,
    city ? eq(companies.city, city) : undefined,
    companySize && companySize !== "all" ? eq(companies.companySize, companySize) : undefined,
    companyStatus && companyStatus !== "all" ? eq(companies.status, companyStatus) : undefined,
  );

  const [{ total }] = await db.select({ total: count() }).from(companies).where(condition);

  // Um contato primário com e-mail válido tem precedência sobre o e-mail principal da empresa,
  // seguindo a mesma regra do envio legado. A expressão evita carregar o público no navegador.
  const [{ eligible, invalidEmail, withoutEmail }] = await db
    .select({ eligible: sql<number>`count(*) filter (where ${audienceRecipient} is not null and not ${audienceKnownInvalid})`,
      invalidEmail: sql<number>`count(*) filter (where ${audienceRecipient} is not null and ${audienceKnownInvalid})`,
      withoutEmail: sql<number>`count(*) filter (where ${audienceRecipient} is null)` })
    .from(companies)
    .leftJoin(
      contacts,
      and(eq(contacts.companyId, companies.id), eq(contacts.id, primaryContactId)),
    )
    .where(condition);

  const totalNumber = Number(total || 0);
  const eligibleNumber = Number(eligible || 0);

  return NextResponse.json({
    total: totalNumber,
    eligible: eligibleNumber,
    withoutEmail: Number(withoutEmail || 0),
    invalidEmail: Number(invalidEmail || 0),
    filters: {
      region: validRegion(region) ? region : null,
      city: city || null,
      companySize: companySize && companySize !== "all" ? companySize : null,
      status: companyStatus && companyStatus !== "all" ? companyStatus : null,
    },
  });
}
