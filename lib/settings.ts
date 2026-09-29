export type CrmConfig = {
  senderName: string;
  signature: string;
  dailySendLimit: number;
  timezone: "America/Sao_Paulo" | "UTC";
};

export const defaultConfig: CrmConfig = {
  senderName: "", signature: "", dailySendLimit: 100, timezone: "America/Sao_Paulo",
};

// Both supported zones have a fixed offset for current CRM operations.
export function sendingDayWindow(timezone = "America/Sao_Paulo", now = new Date()) {
  const offset = timezone === "UTC" ? 0 : 3 * 60 * 60 * 1000;
  const local = new Date(now.getTime() - offset);
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + offset);
  return { start, next: new Date(start.getTime() + 86400000) };
}
