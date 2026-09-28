import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { emailCampaignRecipients, emailCampaigns } from "@/db/schema";

export async function syncCampaignCounters(campaignId: number) {
  const db = getDb();
  const rows = await db
    .select({ status: emailCampaignRecipients.status, total: sql<number>`count(*)` })
    .from(emailCampaignRecipients)
    .where(eq(emailCampaignRecipients.campaignId, campaignId))
    .groupBy(emailCampaignRecipients.status);

  const counts = new Map(rows.map((row) => [row.status, Number(row.total || 0)]));
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  const processing = counts.get("PROCESSING") || 0;
  const uncertain = counts.get("UNCERTAIN") || 0;
  const pending = (counts.get("PENDING") || 0) + processing + uncertain;
  const sent = counts.get("SENT") || 0;
  const failed = counts.get("FAILED") || 0;
  const skipped = counts.get("SKIPPED") || 0;

  await db
    .update(emailCampaigns)
    .set({ total, pending, sent, failed, skipped, updatedAt: new Date() })
    .where(eq(emailCampaigns.id, campaignId));

  return { total, pending, sent, failed, skipped, processing, uncertain };
}
