import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { emailCampaignRecipients, emailCampaigns } from "@/db/schema";
import { syncCampaignCounters } from "@/lib/campaign-counters";

const ownerId = (_request: NextRequest) => "local-preview-user";

type ReviewAction = "mark-sent" | "retry" | "mark-failed";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const db = getDb();
  const owner = ownerId(request);
  const { id } = await context.params;
  const campaignId = Number(id);
  const body = (await request.json()) as { recipientId?: number; action?: ReviewAction };

  if (!Number.isInteger(campaignId) || !Number.isInteger(body.recipientId)) {
    return NextResponse.json({ error: "Campanha ou destinatário inválido." }, { status: 400 });
  }

  if (!body.action || !["mark-sent", "retry", "mark-failed"].includes(body.action)) {
    return NextResponse.json({ error: "Ação de revisão inválida." }, { status: 400 });
  }

  const [campaign] = await db
    .select()
    .from(emailCampaigns)
    .where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.ownerId, owner)))
    .limit(1);

  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
  if (campaign.status !== "PAUSED") {
    return NextResponse.json({ error: "A revisão só é permitida enquanto a campanha está pausada." }, { status: 409 });
  }

  const [recipient] = await db
    .select()
    .from(emailCampaignRecipients)
    .where(and(eq(emailCampaignRecipients.id, body.recipientId!), eq(emailCampaignRecipients.campaignId, campaignId)))
    .limit(1);

  if (!recipient) return NextResponse.json({ error: "Destinatário não encontrado." }, { status: 404 });
  if (recipient.status !== "UNCERTAIN") {
    return NextResponse.json({ error: "Somente envios com resultado incerto podem ser revisados." }, { status: 409 });
  }

  const now = new Date();
  if (body.action === "retry") {
    await db.update(emailCampaignRecipients).set({
      status: "PENDING",
      messageId: null,
      processingStartedAt: null,
      errorMessage: "Reenvio autorizado manualmente após revisão.",
      updatedAt: now,
    }).where(eq(emailCampaignRecipients.id, recipient.id));
  } else if (body.action === "mark-sent") {
    await db.update(emailCampaignRecipients).set({
      status: "SENT",
      processingStartedAt: null,
      sentAt: recipient.sentAt || now,
      errorMessage: "Envio confirmado manualmente após revisão.",
      updatedAt: now,
    }).where(eq(emailCampaignRecipients.id, recipient.id));
  } else {
    await db.update(emailCampaignRecipients).set({
      status: "FAILED",
      processingStartedAt: null,
      errorMessage: "Envio marcado manualmente como falha após revisão.",
      updatedAt: now,
    }).where(eq(emailCampaignRecipients.id, recipient.id));
  }

  const counters = await syncCampaignCounters(campaignId);
  return NextResponse.json({ ok: true, recipientId: recipient.id, action: body.action, counters });
}
