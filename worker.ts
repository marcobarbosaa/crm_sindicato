import vinextHandler from "vinext/server/fetch-handler";

// Different cron events have independent subrequest budgets. Promise.all inside
// a single event does NOT create fresh Worker invocations.
const CAMPAIGN_CRON = "* * * * *";
export default {
  fetch(request, env, ctx) { return vinextHandler.fetch(request, env, ctx); },
  async scheduled(controller) {
    const startedAt = Date.now();
    const event = { event: "scheduled.maintenance", cron: controller.cron, scheduledTime: controller.scheduledTime };
    console.info({ ...event, status: "started" });
    try {
      const { withCampaignDb } = await import("./db");
      await withCampaignDb(async () => {
        if (controller.cron === CAMPAIGN_CRON) {
          const { findDueCampaigns, processCampaignBatch } = await import("./lib/campaign-runner");
          const due = await findDueCampaigns(1);
          for (const campaign of due) await processCampaignBatch(campaign.ownerId, Number(campaign.id));
          console.info({ ...event, status: "completed", campaignsChecked: due.length, durationMs: Date.now() - startedAt });
        } else {
          const { cleanupAttachments } = await import("./lib/attachment-service");
          const cleanup = await cleanupAttachments();
          console.info({ ...event, status: cleanup.pending ? "partial" : "completed", ...cleanup, durationMs: Date.now() - startedAt });
          if (cleanup.pending) throw new Error("Scheduled cleanup incomplete.");
        }
      });
    } catch {
      console.error({ ...event, status: "failed", durationMs: Date.now() - startedAt });
      throw new Error("Scheduled maintenance failed. Check campaign, database and storage configuration.");
    }
  },
} satisfies ExportedHandler<Cloudflare.Env>;
