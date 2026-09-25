import vinextHandler from "vinext/server/fetch-handler";
import { cleanupAttachments } from "./lib/attachment-service";

// Keep the framework's HTTP entrypoint (routing, RSC, assets and context) intact.
export default {
  fetch(request, env, ctx) {
    return vinextHandler.fetch(request, env, ctx);
  },

  async scheduled(controller) {
    const startedAt = Date.now();
    const event = {
      event: "attachments.cleanup",
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    };

    console.info({ ...event, status: "started" });
    let result: Awaited<ReturnType<typeof cleanupAttachments>>;
    try {
      // Uses cloudflare:workers bindings directly, just like the manual route.
      // Awaiting makes the scheduled event track completion and failures.
      result = await cleanupAttachments();
    } catch {
      console.error({ ...event, status: "failed", durationMs: Date.now() - startedAt });
      // Do not expose provider errors, connection strings or secrets in logs.
      throw new Error("Attachment cleanup failed. Check database and storage configuration.");
    }

    const summary = { ...event, ...result, durationMs: Date.now() - startedAt };
    if (result.pending > 0) {
      console.error({ ...summary, status: "partial" });
      throw new Error("Attachment cleanup incomplete. Pending files will be retried on a later run.");
    }
    console.info({ ...summary, status: "completed" });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
