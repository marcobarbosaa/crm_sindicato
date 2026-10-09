// Three account-wide trigger slots. Each event executes one bounded task.
export const CAMPAIGN_CRON = '* * * * *';
export const SMART_SEND_CRON = '1-59/2 * * * *';
export const MAINTENANCE_CRON = '*/2 * * * *';
export const WORKER_CRONS = [CAMPAIGN_CRON, SMART_SEND_CRON, MAINTENANCE_CRON];
const maintenance = ['delivery', 'smart-delivery', 'attachments', 'smart-files'] as const;
export function scheduledTask(cron: string, scheduledTime: number) {
  if (!Number.isFinite(scheduledTime) || scheduledTime < 0) return null;
  if (cron === CAMPAIGN_CRON) return 'campaign';
  if (cron === SMART_SEND_CRON) return 'smart-send';
  // Event time survives delayed delivery/restarts. No process-local counter,
  // catch-up loop or fan-out sharing the invocation's subrequest/CPU budget.
  if (cron === MAINTENANCE_CRON) return maintenance[Math.floor(scheduledTime / 120_000) % maintenance.length];
  return null;
}
