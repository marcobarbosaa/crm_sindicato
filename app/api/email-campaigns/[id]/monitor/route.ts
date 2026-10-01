import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crmSettings, emailCampaignRecipients, emailCampaigns, emailMessages } from "@/db/schema";
import { dailyCampaignUsage } from "@/lib/campaign-quota";
import { sendingDayWindow } from "@/lib/settings";

// Read-only snapshot. No reconciliation, claims or sends during polling.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  const owner = "local-preview-user", db = getDb();
  const [campaign] = await db.select().from(emailCampaigns)
    .where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.ownerId, owner))).limit(1);
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
  const [settings] = await db.select().from(crmSettings).where(eq(crmSettings.ownerId, owner)).limit(1);
  const { start, next } = sendingDayWindow(settings?.timezone);
  const [usage, counts, activities] = await Promise.all([
    db.select({ total: sql<number>`count(*)` }).from(emailMessages).where(dailyCampaignUsage(owner, start, next)),
    db.select({ status: emailCampaignRecipients.status, total: sql<number>`count(*)` })
      .from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId, id)).groupBy(emailCampaignRecipients.status),
    db.select({ id: emailCampaignRecipients.id, companyName: emailCampaignRecipients.companyName,
      recipient: emailCampaignRecipients.recipient, status: emailCampaignRecipients.status,
      failureCategory: emailCampaignRecipients.failureCategory, errorMessage: emailCampaignRecipients.errorMessage, updatedAt: emailCampaignRecipients.updatedAt })
      .from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId, id), or(ne(emailCampaignRecipients.status, "PENDING"), isNotNull(emailCampaignRecipients.errorMessage))))
      .orderBy(desc(emailCampaignRecipients.updatedAt), desc(emailCampaignRecipients.id)).limit(8),
  ]);
  const count = (status: string) => Number(counts.find(row => row.status === status)?.total || 0);
  // Same daily window, SENT predicate and default as getCampaignBatch.
  const dailySendLimit = settings?.dailySendLimit || 100;
  return NextResponse.json({ campaign, monitoring: {
    remainingToday: Math.max(0, dailySendLimit - Number(usage[0]?.total || 0)), dailySendLimit,
    nextDailyWindow: next, timezone: settings?.timezone || "America/Sao_Paulo",
    queued: count("PENDING"), processing: count("PROCESSING"), uncertain: count("UNCERTAIN"), activities,
  } }, { headers: { "Cache-Control": "no-store" } });
}
