import { GmailOAuthError } from "./gmail";
import { MAX_MIME_BYTES } from "./delivery-parser";

export class DeliverySyncError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DeliverySyncError"; }
}
async function boundedJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new DeliverySyncError("GMAIL_INVALID_RESPONSE");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw new DeliverySyncError("MESSAGE_TOO_LARGE");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally { await reader.cancel().catch(() => {}); }
}
// Read-only Google requests. Retry is delegated to the next cron, never a loop.
export async function gmailDeliveryGet(accessToken: string, path: string, params: URLSearchParams, limit = 16_384, deadline = Date.now() + 10_000) {
  if (deadline <= Date.now()) throw new DeliverySyncError("DELIVERY_DEADLINE");
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` }, redirect: "manual", signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))),
  }).catch(() => { throw new DeliverySyncError("GMAIL_UNAVAILABLE"); });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) throw new GmailOAuthError(401, "invalid_grant");
    if (response.status === 403) throw new DeliverySyncError("GMAIL_READ_FORBIDDEN");
    if (response.status === 429) throw new DeliverySyncError("GMAIL_RATE_LIMIT");
    if (response.status === 400) throw new DeliverySyncError("GMAIL_BAD_REQUEST");
    if (response.status === 404) throw new DeliverySyncError("GMAIL_NOT_FOUND");
    throw new DeliverySyncError(response.status >= 500 ? "GMAIL_UNAVAILABLE" : "GMAIL_READ_FAILED");
  }
  try { return await boundedJson(response, limit); }
  catch (error) { if (error instanceof DeliverySyncError) throw error; throw new DeliverySyncError("GMAIL_INVALID_RESPONSE"); }
}
export async function listDeliveryCandidates(token: string, after: number, before: number, pageToken?: string | null, deadline?: number) {
  const q = `after:${Math.floor(after / 1000)} before:${Math.ceil(before / 1000)} {from:mailer-daemon from:postmaster from:mail-daemon from:MicrosoftExchange from:"Mail Delivery Subsystem" subject:undelivered subject:undeliverable subject:"delivery status" subject:"returned mail" subject:"falha na entrega" subject:"não entregue" subject:"non remis" subject:unzustellbar subject:"no se pudo entregar"}`;
  const params = new URLSearchParams({ q, maxResults: "1", includeSpamTrash: "true", fields: "messages(id),nextPageToken" });
  if (pageToken) params.set("pageToken", pageToken);
  const data = await gmailDeliveryGet(token, "messages", params, 16_384, deadline) as { messages?: { id?: unknown }[]; nextPageToken?: unknown };
  if (!data || typeof data !== "object" || Array.isArray(data) || (data.messages !== undefined && !Array.isArray(data.messages)) || (data.nextPageToken !== undefined && (typeof data.nextPageToken !== "string" || data.nextPageToken.length > 2048))) throw new DeliverySyncError("GMAIL_INVALID_RESPONSE");
  const ids = (data.messages || []).map(message => message.id);
  if (ids.length > 1 || ids.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(id))) throw new DeliverySyncError("GMAIL_INVALID_RESPONSE");
  return { ids: ids as string[], nextPageToken: typeof data.nextPageToken === "string" ? data.nextPageToken : null };
}
export async function readDeliveryCandidate(token: string, id: string, deadline?: number) {
  const data = await gmailDeliveryGet(token, `messages/${encodeURIComponent(id)}`, new URLSearchParams({ format: "raw", fields: "id,threadId,internalDate,raw" }), Math.ceil(MAX_MIME_BYTES * 4 / 3) + 4096, deadline) as { id?: string; threadId?: string; internalDate?: string; raw?: string };
  if (data?.id !== id || typeof data.raw !== "string" || !Number.isFinite(Number(data.internalDate))) throw new DeliverySyncError("GMAIL_INVALID_RESPONSE");
  const raw = Buffer.from(data.raw, "base64url");
  if (raw.length > MAX_MIME_BYTES) throw new DeliverySyncError("MESSAGE_TOO_LARGE");
  return { id, threadId: typeof data.threadId === "string" ? data.threadId.slice(0, 200) : null, receivedAt: Number(data.internalDate), raw: raw.toString("utf8") };
}
export async function findOriginalProviderIds(token: string, reference: string, deadline?: number) {
  const data = await gmailDeliveryGet(token, "messages", new URLSearchParams({ q: `in:sent rfc822msgid:${reference.slice(1, -1)}`, maxResults: "2", fields: "messages(id)" }), 16_384, deadline) as { messages?: { id: string }[] };
  if (!data || typeof data !== "object" || Array.isArray(data) || (data.messages && !Array.isArray(data.messages))) throw new DeliverySyncError("GMAIL_INVALID_RESPONSE");
  return (data.messages || []).map(row => row.id).filter(id => typeof id === "string");
}
