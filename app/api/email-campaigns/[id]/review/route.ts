import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { emailCampaignRecipients, emailCampaigns, emailMessages } from "@/db/schema";
import { syncCampaignCounters } from "@/lib/campaign-counters";

type ReviewAction = "mark-sent" | "retry" | "mark-failed";
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const db = getDb(), owner = "local-preview-user", campaignId = Number((await context.params).id);
  const body = await request.json() as { recipientId?: number; action?: ReviewAction };
  if (!Number.isInteger(campaignId) || !Number.isInteger(body.recipientId)) return NextResponse.json({ error: "Campanha ou destinatário inválido." }, { status: 400 });
  if (!body.action || !["mark-sent", "retry", "mark-failed"].includes(body.action)) return NextResponse.json({ error: "Ação de revisão inválida." }, { status: 400 });
  const reviewed = await db.transaction(async tx => {
    const [campaign] = await tx.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.ownerId, owner))).for("update");
    if (!campaign || campaign.status !== "PAUSED" || (campaign.lockUntil && campaign.lockUntil > new Date())) return false;
    const [recipient] = await tx.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.id, body.recipientId!), eq(emailCampaignRecipients.campaignId, campaignId))).for("update");
    if (!recipient || recipient.status !== "UNCERTAIN") return false;
    const now = new Date(), status = body.action === "retry" ? "PENDING" : body.action === "mark-sent" ? "SENT" : "FAILED";
    const errorMessage = body.action === "retry" ? "Reenvio autorizado manualmente após revisão." : body.action === "mark-sent" ? "Envio confirmado manualmente após revisão." : "Envio marcado manualmente como falha após revisão.";
    await tx.update(emailCampaignRecipients).set({ status, processingStartedAt: null, failureCategory: null, errorMessage, updatedAt: now,
      ...(status === "PENDING" ? { messageId: null, attempts: 0, lastBatchId: null } : {}),
      ...(status === "SENT" ? { sentAt: recipient.sentAt || now } : {}),
    }).where(and(eq(emailCampaignRecipients.id, recipient.id), eq(emailCampaignRecipients.status, "UNCERTAIN")));
    if (recipient.messageId) await tx.update(emailMessages).set({ status: status === "SENT" ? "SENT" : "FAILED", errorMessage,
      ...(status === "SENT" ? { sentAt: recipient.sentAt || now } : {}),
    }).where(eq(emailMessages.id, recipient.messageId));
    return true;
  });
  if (!reviewed) return NextResponse.json({ error: "Pause a campanha, aguarde o processamento terminar e revise somente envios incertos." }, { status: 409 });
  return NextResponse.json({ ok: true, recipientId: body.recipientId, action: body.action, counters: await syncCampaignCounters(campaignId) });
}
