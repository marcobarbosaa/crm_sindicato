import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb, withCampaignDb } from "@/db";
import { activityLogs, companies } from "@/db/schema";
import { normalizeEmail } from "@/lib/delivery-policy";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const owner = "local-preview-user", id = Number((await context.params).id);
  const body = await request.json().catch(() => null) as { expectedEmail?: unknown } | null;
  if (!Number.isSafeInteger(id) || id <= 0 || typeof body?.expectedEmail !== "string") return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const expectedEmail = normalizeEmail(body.expectedEmail);
  return withCampaignDb(async () => {
    const db = getDb();
    const [existing] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, id), eq(companies.ownerId, owner))).limit(1);
    if (!existing) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
    const restored = await db.transaction(async tx => {
      const [row] = await tx.update(companies).set({ primaryEmailStatus: "UNKNOWN", primaryEmailStatusReason: null, primaryEmailStatusUpdatedAt: new Date() })
        .where(and(eq(companies.id, id), eq(companies.ownerId, owner), sql`lower(btrim(coalesce(${companies.primaryEmail}, ''))) = ${expectedEmail}`)).returning({ id: companies.id });
      if (!row) return false;
      await tx.insert(activityLogs).values({ ownerId: owner, companyId: id, type: "EMAIL_ADDRESS_REVIEWED", description: "Status do e-mail restaurado manualmente para desconhecido.", createdAt: new Date() });
      return true;
    });
    return restored ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "O endereço mudou. Atualize a empresa antes de revisar." }, { status: 409 });
  });
}
