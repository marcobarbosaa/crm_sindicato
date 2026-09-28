import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { emailCampaigns, emailTemplates } from "@/db/schema";

const ownerId = () => "local-preview-user";

type Audience = {
  region?: number;
  city?: string;
  companySize?: string;
  companyStatus?: string;
  groupIds?: number[];
};

type CreateCampaignInput = {
  name?: string;
  templateId?: number;
  audience?: Audience;
  batchSize?: number;
  intervalMinutes?: number;
};

export async function GET() {
  const db = getDb();
  const owner = ownerId();
  const rows = await db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.ownerId, owner))
    .orderBy(desc(emailCampaigns.createdAt))
    .limit(100);
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const db = getDb();
  const owner = ownerId();
  const input = (await request.json()) as CreateCampaignInput;
  const name = input.name?.trim();
  const templateId = Number(input.templateId);

  if (!name) return NextResponse.json({ error: "Informe o nome da campanha." }, { status: 400 });
  if (!Number.isInteger(templateId)) return NextResponse.json({ error: "Selecione um template válido." }, { status: 400 });

  const [template] = await db
    .select({ id: emailTemplates.id })
    .from(emailTemplates)
    .where(and(eq(emailTemplates.id, templateId), eq(emailTemplates.ownerId, owner)))
    .limit(1);
  if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });

  const batchSize = Number.isInteger(input.batchSize) ? Math.min(100, Math.max(1, Number(input.batchSize))) : 25;
  const intervalMinutes = Number.isInteger(input.intervalMinutes) ? Math.max(1, Number(input.intervalMinutes)) : 10;
  const audience: Audience = {
    ...(Number.isInteger(input.audience?.region) && Number(input.audience?.region) >= 1 && Number(input.audience?.region) <= 17 ? { region: Number(input.audience?.region) } : {}),
    ...(input.audience?.city?.trim() ? { city: input.audience.city.trim() } : {}),
    ...(input.audience?.companySize?.trim() ? { companySize: input.audience.companySize.trim() } : {}),
    ...(input.audience?.companyStatus?.trim() ? { companyStatus: input.audience.companyStatus.trim() } : {}),
    ...(Array.isArray(input.audience?.groupIds) ? { groupIds: input.audience.groupIds.filter(Number.isInteger) } : {}),
  };
  const now = new Date();
  const [campaign] = await db.insert(emailCampaigns).values({
    ownerId: owner,
    name,
    templateId,
    status: "DRAFT",
    audience,
    batchSize,
    intervalMinutes,
    createdAt: now,
    updatedAt: now,
  }).returning();

  return NextResponse.json(campaign, { status: 201 });
}
