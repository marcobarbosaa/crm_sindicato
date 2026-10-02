// Only fixed codes and numeric provider statuses cross this boundary. Never log Error objects.
export class SendFailure extends Error {
  constructor(readonly category: string, readonly code: string, readonly status = 503, readonly providerStatus?: number) {
    super(code);
  }
}

export function runtimeFailure(error: unknown): SendFailure | undefined {
  if (!(error instanceof Error)) return;
  if (/Invalid redirect value/i.test(error.message)) return new SendFailure("RUNTIME_FAILURE", "FETCH_REDIRECT_MODE_UNSUPPORTED");
  if (/too many subrequests/i.test(error.message)) return new SendFailure("RUNTIME_FAILURE", "CLOUDFLARE_SUBREQUEST_LIMIT");
  if (/cannot perform i\/o on behalf of a different request/i.test(error.message)) return new SendFailure("RUNTIME_FAILURE", "CLOUDFLARE_CROSS_REQUEST_IO");
}

export function databaseFailure(error: unknown): SendFailure {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const runtime = runtimeFailure(current);
    if (runtime) return runtime;
    if (current instanceof Error && current.message.startsWith("DATABASE_URL is unavailable")) return new SendFailure("DATABASE_FAILURE", "DATABASE_CONFIGURATION");
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === "string" && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "CONNECT_TIMEOUT", "53300", "42P01", "42703", "28P01", "42501", "23503", "23514"].includes(code)) {
      return new SendFailure("DATABASE_FAILURE", code);
    }
    current = cause;
  }
  return new SendFailure("DATABASE_FAILURE", "DATABASE_OPERATION_FAILED");
}

export function logSend(requestId: string, stage: string, outcome: string, failure?: SendFailure) {
  console.info(JSON.stringify({ event: "email.send", kind: "INDIVIDUAL", requestId, stage, outcome,
    ...(failure ? { category: failure.category, errorCode: failure.code, httpStatus: failure.status, providerStatus: failure.providerStatus } : {}) }));
}
