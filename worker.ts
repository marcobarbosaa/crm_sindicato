import vinextHandler from "vinext/server/fetch-handler";
import { cleanupAttachments } from "./lib/attachment-service";
import { findDueCampaigns, processCampaignBatch } from "./lib/campaign-runner";

const MAX_CAMPAIGNS_PER_RUN = 5;

// Keep the framework's HTTP entrypoint (routing, RSC, assets and context) intact.
export default {
  fetch(request, env, ctx) {
    return vinextHandler.fetch(request, env, ctx);
  },

  async scheduled(controller) {
    const startedAt = Date.now();
    const event = {
      event: "scheduled.maintenance",
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    };

    console.info({ ...event, status: "started" });
    try {
      // Campanhas vencidas são processadas pelo servidor, independentemente de
      // qualquer página estar aberta no navegador.
      const due = await findDueCampaigns(MAX_CAMPAIGNS_PER_RUN);
      const campaignResults = await Promise.allSettled(
        due.map(campaign => processCampaignBatch(campaign.ownerId, Number(campaign.id))),
      );
      const campaignFailures = campaignResults.filter(result => result.status === "rejected").length;

      // A mesma execução periódica continua responsável pela limpeza dos anexos.
      const cleanup = await cleanupAttachments();
      const summary = {
        ...event,
        campaignsChecked: due.length,
        campaignFailures,
        attachmentsDeleted: cleanup.deleted,
        attachmentsPending: cleanup.pending,
        durationMs: Date.now() - startedAt,
      };

      if (campaignFailures > 0 || cleanup.pending > 0) {
        console.error({ ...summary, status: "partial" });
        throw new Error("Scheduled maintenance incomplete. Pending work will be retried on a later run.");
      }

      console.info({ ...summary, status: "completed" });
    } catch {
      console.error({ ...event, status: "failed", durationMs: Date.now() - startedAt });
      // Do not expose provider errors, connection strings or secrets in logs.
      throw new Error("Scheduled maintenance failed. Check campaign, database and storage configuration.");
    }
  },
} satisfies ExportedHandler<Cloudflare.Env>;
