// Shared pure policy; no Gmail credentials or server imports belong here.
export const DELIVERY_WINDOW_MS = 24 * 60 * 60_000;
export const DELIVERY_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
export const normalizeEmail = (value?: string | null) => (value || "").trim().toLowerCase();
export const deliveryLabels: Record<string, string> = {
  PENDING: "Aguardando análise", NO_KNOWN_FAILURE: "Sem falha conhecida", BOUNCED: "Devolvido",
  ADDRESS_NOT_FOUND: "Endereço inexistente", DOMAIN_NOT_FOUND: "Domínio inexistente",
  MAILBOX_FULL: "Caixa cheia", BLOCKED: "Bloqueado/recusado", TEMPORARY_FAILURE: "Falha temporária",
  UNKNOWN_FAILURE: "Falha desconhecida", UNKNOWN: "Desconhecido", INVALID: "E-mail inválido conhecido",
  MESSAGE_REJECTED: "Mensagem recusada", SPAM_REJECTED: "Recusado como spam",
  POLICY_REJECTION: "Recusado por política", TEMPORARY_SERVER_FAILURE: "Falha temporária",
};
export function safeDiagnostic(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}
export function classifyDeliveryFailure(status: string, diagnostic: string) {
  const code = status.match(/\b[245]\.\d{1,3}\.\d{1,3}\b/)?.[0] || "";
  const text = safeDiagnostic(diagnostic).toLowerCase();
  let category = "UNKNOWN", deliveryStatus = "UNKNOWN_FAILURE", invalid = false;
  if (code.startsWith("4.")) { category = "TEMPORARY_SERVER_FAILURE"; deliveryStatus = "TEMPORARY_FAILURE"; }
  else if (code === "5.2.2" || /mailbox full|quota exceeded|over quota/.test(text)) { category = "MAILBOX_FULL"; deliveryStatus = "MAILBOX_FULL"; }
  else if (code.startsWith("5.7.") || /spam|policy|blocked|blacklist/.test(text)) { category = /spam/.test(text) ? "SPAM_REJECTED" : "POLICY_REJECTION"; deliveryStatus = "BLOCKED"; }
  else if (code === "5.1.1" || (!code && /\b(user unknown|no such user|address not found)\b/.test(text))) { category = "ADDRESS_NOT_FOUND"; deliveryStatus = "BOUNCED"; invalid = true; }
  else if (code === "5.1.2" && /domain.*(not found|does not exist|non.?existent)|nxdomain|host.*not found/.test(text)) { category = "DOMAIN_NOT_FOUND"; deliveryStatus = "BOUNCED"; invalid = true; }
  else if (/temporary|try again later/.test(text)) { category = "TEMPORARY_SERVER_FAILURE"; deliveryStatus = "TEMPORARY_FAILURE"; }
  else if (/reject|refused/.test(text)) { category = "MESSAGE_REJECTED"; deliveryStatus = "BLOCKED"; }
  return { category, deliveryStatus, invalid, smtpStatus: code || null, diagnostic: safeDiagnostic(diagnostic) };
}
export function csvCell(value: unknown) {
  let text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
