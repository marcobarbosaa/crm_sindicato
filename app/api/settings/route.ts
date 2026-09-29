import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { crmSettings } from "@/db/schema";
import { defaultConfig } from "@/lib/settings";

const owner = "local-preview-user";
const schema = z.object({
  senderName: z.string().trim().max(100),
  signature: z.string().trim().max(2000),
  dailySendLimit: z.number().int().min(1).max(500),
  timezone: z.enum(["America/Sao_Paulo", "UTC"]),
}).partial().strict();

export async function GET() {
  const [settings] = await getDb().select().from(crmSettings).where(eq(crmSettings.ownerId, owner)).limit(1);
  return NextResponse.json(settings || { ownerId: owner, ...defaultConfig });
}

export async function PATCH(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Verifique os campos: nome até 100 caracteres, assinatura até 2000, limite inteiro entre 1 e 500 e fuso válido." }, { status: 400 });
  }
  const values = { ...parsed.data, updatedAt: new Date() };
  const [saved] = await getDb().insert(crmSettings).values({ ownerId: owner, ...defaultConfig, ...values })
    .onConflictDoUpdate({ target: crmSettings.ownerId, set: values }).returning();
  return NextResponse.json(saved);
}
