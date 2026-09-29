import type { CrmConfig } from "@/lib/settings";
export type { CrmConfig };
export type SettingsTab = "general" | "gmail" | "emails" | "sending" | "followups" | "data" | "security";
export type SettingsDestination = "companies" | "templates" | "imports" | "emails" | "batch" | "followups";
export type GmailStatus = {
  configured: boolean; connected: boolean; needsReconnect: boolean;
  account: { email: string; connectedAt: string } | null;
  scopes: string[];
};
export type SettingsSummary = {
  companies: number; contacts: number; sent: number; failed: number; sentToday: number;
  dailySendLimit: number; timezone: string; updatedAt: string;
  followups: { total: number; pending: number; overdue: number; completed: number };
  imports: { id: number; fileName: string; totalRows: number; importedRows: number; updatedRows: number; skippedRows: number; errorRows: number; createdAt: string }[];
};
export type ConfigProps = { config: CrmConfig; update: (patch: Partial<CrmConfig>) => void };
