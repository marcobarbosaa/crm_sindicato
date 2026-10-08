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
        } else if (controller.cron === "1-59/2 * * * *") {
          const { findDueSmartBatch, processSmartBatch } = await import("./lib/smart-send-runner");
          const batch = await findDueSmartBatch();
          if (batch) await processSmartBatch(batch.ownerId, batch.id);
          console.info({ ...event, status: "completed", smartBatches: batch ? 1 : 0 });
        } else if (controller.cron === "3-59/5 * * * *") {
          const { cleanupSmartFiles } = await import("./lib/smart-send-service");
          const cleanup = await cleanupSmartFiles();
          console.info({ ...event, status: "completed", ...cleanup });
        } else if (controller.cron === "2-59/3 * * * *") {
          const { checkSmartDelivery } = await import("./lib/smart-send-delivery");
          const result = await checkSmartDelivery();
          console.info({ ...event, status: "completed", ...result });
        } else if (controller.cron === "*/2 * * * *") {
          const { processPendingDeliveryChecks } = await import("./lib/gmail-delivery");
          const delivery = await processPendingDeliveryChecks();
          console.info({ ...event, status: "completed", ...delivery, durationMs: Date.now() - startedAt });
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
