import { classifyDeliveryFailure, normalizeEmail } from "./delivery-policy";

export const MAX_MIME_BYTES = 256 * 1024;
export type DeliveryNotice = ReturnType<typeof classifyDeliveryFailure> & {
  recipient: string; originalMessageIds: string[]; action: string;
};
export function messageIds(value: string) {
  return [...new Set(value.match(/<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+>/g) || [])].slice(0, 10);
}
function headers(text: string) {
  const result = new Map<string, string>();
  for (const line of text.slice(0, 32_768).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).slice(0, 100)) {
    const split = line.indexOf(":");
    if (split <= 0) continue;
    const key = line.slice(0, split).trim().toLowerCase(), value = line.slice(split + 1).trim();
    result.set(key, result.has(key) ? result.get(key) + " " + value : value);
  }
  return result;
}
function splitPart(raw: string) {
  const match = /\r?\n\r?\n/.exec(raw);
  return match ? { head: headers(raw.slice(0, match.index)), body: raw.slice(match.index + match[0].length) } : { head: headers(raw), body: "" };
}
function decodeBody(body: string, encoding?: string) {
  if (encoding?.toLowerCase() === "base64") return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
  if (encoding?.toLowerCase() === "quoted-printable") return body.replace(/=\r?\n/g, "").replace(/=([\da-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return body;
}
// Only DSN fields and original-message headers are interpreted. HTML, attachments,
// arbitrary email addresses in prose and URLs have no role in correlation.
export function parseDeliveryStatus(raw: string): { notices: DeliveryNotice[]; incomplete: boolean } {
  if (Buffer.byteLength(raw, "utf8") > MAX_MIME_BYTES) return { notices: [], incomplete: true };
  const blocks: Map<string, string>[] = [], references = new Set<string>();
  let count = 0, incomplete = false, report = false;
  function remember(head: Map<string, string>, original: boolean) {
    for (const key of original ? ["message-id", "original-message-id"] : ["original-message-id", "in-reply-to", "references"]) {
      for (const id of messageIds(head.get(key) || "")) references.add(id);
    }
  }
  function visit(part: string, depth: number, original = false) {
    if (++count > 64 || depth > 8) { incomplete = true; return; }
    const { head, body } = splitPart(part);
    const contentType = head.get("content-type") || "text/plain", mime = contentType.split(";")[0].trim().toLowerCase();
    remember(head, original);
    // Never recurse into an attached original body: it may contain unrelated DSNs.
    if (original) return;
    if (mime === "multipart/report") report = true;
    if (mime.startsWith("multipart/")) {
      const boundary = /boundary\s*=\s*(?:"([^"\r\n]{1,200})"|([^;\s]{1,200}))/i.exec(contentType);
      if (!boundary) { incomplete = true; return; }
      const delimiter = "--" + (boundary[1] || boundary[2]);
      const segments = body.split(/\r?\n/);
      let current: string[] | null = null;
      for (const line of segments) {
        if (line.trimEnd() === delimiter || line.trimEnd() === delimiter + "--") {
          if (current) visit(current.join("\r\n"), depth + 1);
          current = line.trimEnd() === delimiter ? [] : null;
        } else if (current) current.push(line);
      }
      if (current) { incomplete = true; visit(current.join("\r\n"), depth + 1); }
    } else if (["message/delivery-status", "message/global-delivery-status"].includes(mime)) {
      const decoded = decodeBody(body, head.get("content-transfer-encoding"));
      for (const block of decoded.split(/\r?\n\s*\r?\n/).slice(0, 20)) {
        const fields = headers(block); remember(fields, false);
        if (fields.has("final-recipient") || fields.has("original-recipient")) blocks.push(fields);
      }
    } else if (["message/rfc822", "message/global"].includes(mime)) {
      visit(decodeBody(body, head.get("content-transfer-encoding")), depth + 1, true);
    } else if (mime === "text/rfc822-headers") {
      remember(headers(decodeBody(body, head.get("content-transfer-encoding"))), true);
    }
  }
  visit(raw, 0);
  if (!report || !blocks.length) return { notices: [], incomplete: true };
  if (blocks.length > 3 || references.size > 10) return { notices: [], incomplete: true };
  const notices: DeliveryNotice[] = [];
  for (const fields of blocks) {
    const action = (fields.get("action") || "").toLowerCase();
    if (!["failed", "delayed"].includes(action)) continue;
    const value = fields.get("original-recipient") || fields.get("final-recipient") || "";
    const recipient = normalizeEmail(value.replace(/^rfc822\s*;\s*/i, ""));
    if (!/^[^\s<>@;]+@[^\s<>@;]+\.[^\s<>@;]+$/.test(recipient)) { incomplete = true; continue; }
    const status = fields.get("status") || "";
    const failure = classifyDeliveryFailure(status, fields.get("diagnostic-code") || "");
    // A delayed notification can never prove permanent invalidity.
    if (action === "delayed") Object.assign(failure, { invalid: false, category: "TEMPORARY_SERVER_FAILURE", deliveryStatus: "TEMPORARY_FAILURE" });
    notices.push({ ...failure, recipient, originalMessageIds: [...references], action });
  }
  return { notices, incomplete };
}

export type CorrelationCandidate = { id: number; campaignId: number | null; recipient: string; sentAt: Date | null; rfcMessageId: string | null; providerMessageId: string | null };
export function correlateDeliveryNotice(notice: DeliveryNotice, messages: CorrelationCandidate[], campaignId: number, receivedAt: number, lookbackMs: number, providerIds: string[] = []) {
  const eligible = messages.filter(message => normalizeEmail(message.recipient) === notice.recipient && message.sentAt && +message.sentAt <= receivedAt && +message.sentAt >= receivedAt - lookbackMs);
  const references = notice.originalMessageIds;
  const exact = eligible.filter(message => (message.rfcMessageId && references.includes(message.rfcMessageId)) || (message.providerMessageId && providerIds.includes(message.providerMessageId)));
  // References that failed to match may refer to another campaign/account. Do not
  // downgrade to recipient-only matching when a reference was actually supplied.
  const candidates = references.length || providerIds.length ? exact : eligible;
  return candidates.length === 1 && candidates[0].campaignId === campaignId ? candidates[0] : null;
}
