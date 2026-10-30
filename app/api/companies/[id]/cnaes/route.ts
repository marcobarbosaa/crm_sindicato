import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, activityLogs } from "@/db/schema";
import { lookupBrasilApi, normalizeCnpjForLookup } from "@/lib/cnae";

// Matches the existing owner scoping in the companies API.
const ownerId = () => "local-preview-user";

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const owner = ownerId();
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Empresa inválida." }, { status: 400 });
  const db = getDb();
  const [company] = await db.select().from(companies)
    .where(and(eq(companies.id, id), eq(companies.ownerId, owner))).limit(1);
  if (!company) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
  const cnpj = normalizeCnpjForLookup(company.cnpj);
  if (!cnpj) return NextResponse.json({ error: "Cadastre um CNPJ válido antes de consultar CNAEs." }, { status: 422 });
  // One remote request at a time, manually triggered. Reuse recent results to
  // avoid abusive repeated requests to the free service.
  const age = company.cnaeSyncedAt ? Date.now() - new Date(company.cnaeSyncedAt).getTime() : Infinity;
  if (company.cnaeSource === "BRASILAPI" && age >= 0 && age < 24 * 60 * 60 * 1000) {
    return NextResponse.json({ company, cached: true });
  }
  try {
    const snapshot = await lookupBrasilApi(cnpj);
    const now = new Date();
    const [updated] = await db.update(companies).set({
      cnaePrimaryCode: snapshot.principal.code,
      cnaePrimaryDescription: snapshot.principal.description,
      cnaeSecondaries: snapshot.secondaries,
      cnaeSource: "BRASILAPI",
      cnaeReference: null,
      cnaeSyncedAt: now,
      updatedAt: now,
    }).where(and(eq(companies.id, id), eq(companies.ownerId, owner), eq(companies.cnpj, company.cnpj!))).returning();
    if (!updated) return NextResponse.json({ error: "O CNPJ da empresa foi alterado durante a consulta. Tente novamente." }, { status: 409 });
    await db.insert(activityLogs).values({
      ownerId: owner, companyId: id, type: "CNAE_UPDATED",
      description: "Atividades econômicas verificadas via BrasilAPI",
      createdAt: now,
    });
    return NextResponse.json({ company: updated, cached: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível consultar CNAEs." }, { status: 502 });
  }
}
