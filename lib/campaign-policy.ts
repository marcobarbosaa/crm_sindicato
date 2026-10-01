// A logical batch is independent of the bounded work performed by one invocation.
export const TECHNICAL_CHUNK_SIZE = 5;
export const MAX_ATTEMPTS = 3;
export const CHUNK_DEADLINE_MS = 60_000;
export const INFRASTRUCTURE_NOTICE = "Processamento adiado. Limite temporário ou indisponibilidade da infraestrutura. Será tentado novamente.";
export const UNCERTAIN_NOTICE = "O envio pode ter sido aceito pelo Gmail. Revise antes de autorizar outro envio.";
export type FailureCategory = "PERMANENT_PROVIDER_FAILURE" | "RETRYABLE_PROVIDER_FAILURE" | "INFRASTRUCTURE_FAILURE" | "UNCERTAIN_DELIVERY";

export function isSubrequestLimit(error: unknown) {
  return /too many subrequests/i.test(error instanceof Error ? error.message : String(error));
}

export function classifyGmailFailure(status: number, message: string): FailureCategory {
  return status === 408 || status === 429 || status >= 500 || /rate.?limit|backend.?error|temporarily unavailable|internal.?error|quota exceeded/i.test(message)
    ? "RETRYABLE_PROVIDER_FAILURE" : "PERMANENT_PROVIDER_FAILURE";
}

export function classifyRuntimeFailure(sendStarted: boolean): FailureCategory {
  return sendStarted ? "UNCERTAIN_DELIVERY" : "INFRASTRUCTURE_FAILURE";
}

export function providerRecipientStatus(category: FailureCategory, attempts: number) {
  return category === "RETRYABLE_PROVIDER_FAILURE" && attempts < MAX_ATTEMPTS ? "PENDING" : "FAILED";
}

export function staleDisposition(messageStatus?: string | null) {
  if (!messageStatus || messageStatus === "PREPARED") return "PENDING";
  if (messageStatus === "SENT") return "SENT";
  if (messageStatus === "FAILED") return "FAILED";
  if (messageStatus === "RETRYABLE") return "PENDING";
  // Legacy QUEUED messages have no durable pre-send barrier: never resend them.
  return "UNCERTAIN";
}
