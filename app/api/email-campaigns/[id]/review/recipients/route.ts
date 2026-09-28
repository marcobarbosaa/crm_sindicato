import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { emailCampaignRecipients, emailCampaigns } from "@/db/schema";

const ownerId = () => "local-preview-user";

export async function GET(...[, context]: [NextRequest, { params: Promise<{ id: string }> }]) {
  const db = getDb();
  const owner = ownerId();
  const { id } = await context.params;
  const campaignId = Number(id);

  if (!Number.isInteger(campaignId)) {
    return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  }

  const [campaign] = await db
    .select({ id: emailCampaigns.id, status: emailCampaigns.status })
    .from(emailCampaigns)
    .where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.ownerId, owner)))
    .limit(1);

  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });

  const recipients = await db
    .select({
      id: emailCampaignRecipients.id,
      recipient: emailCampaignRecipients.recipient,
      companyName: emailCampaignRecipients.companyName,
      attempts: emailCampaignRecipients.attempts,
      errorMessage: emailCampaignRecipients.errorMessage,
      updatedAt: emailCampaignRecipients.updatedAt,
    })
    .from(emailCampaignRecipients)
    .where(and(
      eq(emailCampaignRecipients.campaignId, campaignId),
      eq(emailCampaignRecipients.status, "UNCERTAIN"),
    ))
    .orderBy(asc(emailCampaignRecipients.id))
    .limit(100);

  return NextResponse.json({ campaignStatus: campaign.status, recipients });
}
