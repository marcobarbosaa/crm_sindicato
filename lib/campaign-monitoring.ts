/** Pure display helpers: the server remains authoritative for scheduling. */
export function remainingTime(nextRunAt: string | null | undefined, now: number) {
  const target = nextRunAt ? Date.parse(nextRunAt) : NaN;
  return Number.isFinite(target) ? Math.max(0, target - now) : 0;
}

export function formatCountdown(milliseconds: number) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${hours ? `${pad(hours)}:` : ""}${pad(minutes)}:${pad(seconds % 60)}`;
}

export type CampaignMonitoring = {
  remainingToday: number;
  dailySendLimit: number;
  nextDailyWindow: string;
  timezone: string;
  queued: number;
  processing: number;
  uncertain: number;
  activities: {
    id: number;
    companyName: string;
    recipient: string;
    status: string;
    errorMessage: string | null;
    failureCategory?: string | null;
    updatedAt: string;
  }[];
};
