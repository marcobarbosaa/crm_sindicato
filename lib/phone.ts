export type WhatsAppStatus = "UNKNOWN" | "YES" | "NO";

export function normalizeBrazilianPhone(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits;
}

export function formatBrazilianPhone(value: string | null | undefined): string {
  const digits = normalizeBrazilianPhone(value);
  if (!digits) return "";
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  const prefix = digits.startsWith("55") ? "+55 " : "";
  if (local.length === 11)
    return `${prefix}(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10)
    return `${prefix}(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits.startsWith("55") ? `+${digits}` : digits;
}

export function normalizeWhatsAppStatus(value: unknown): WhatsAppStatus {
  return value === "YES" || value === "NO" ? value : "UNKNOWN";
}
