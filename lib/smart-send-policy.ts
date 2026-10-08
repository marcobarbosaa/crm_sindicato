export class SmartSendError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export const SMART_DEFAULTS = { fileBytes: 4 * 1024 * 1024, batchFiles: 100, pages: 50, textChars: 200_000, draftHours: 24, retentionDays: 30, intervalSeconds: 60 };
export type SmartLimits = typeof SMART_DEFAULTS;
export function smartLimits(config: (key: string) => string | undefined): SmartLimits {
  const bounded = (key: string, fallback: number, max: number) => {
    const n = Number(config(key)); return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
  };
  return { ...SMART_DEFAULTS,
    fileBytes: bounded('SMART_SEND_FILE_BYTES', SMART_DEFAULTS.fileBytes, 8 * 1024 * 1024),
    batchFiles: bounded('SMART_SEND_BATCH_FILES', 100, 500),
    pages: bounded('SMART_SEND_MAX_PAGES', 50, 100),
    draftHours: bounded('SMART_SEND_DRAFT_HOURS', 24, 168),
    retentionDays: bounded('SMART_SEND_RETENTION_DAYS', 30, 365),
    intervalSeconds: bounded('SMART_SEND_INTERVAL_SECONDS', 60, 3600),
  };
}
export function validateSmartFile(file: { name: string; type: string; size: number }, limits = SMART_DEFAULTS) {
  if (!file.name || file.name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(file.name) || !/\.pdf$/i.test(file.name)) throw new SmartSendError('Selecione um PDF com nome válido (até 180 caracteres).');
  if (file.type !== 'application/pdf') throw new SmartSendError('O tipo MIME deve ser application/pdf.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > limits.fileBytes) throw new SmartSendError(`PDF excede o limite de ${limits.fileBytes / 1024 / 1024} MB.`);
}
export function validRecipient(value: string | null | undefined) {
  return !!value && value.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value);
}
export function recipientReview(company: { primaryEmail: string | null; primaryEmailStatus: string } | undefined) {
  if (!company) return 'COMPANY_NOT_FOUND';
  if (!company.primaryEmail?.trim()) return 'NO_EMAIL';
  if (!validRecipient(company.primaryEmail.trim()) || company.primaryEmailStatus === 'INVALID') return 'INVALID_EMAIL';
  return 'IDENTIFIED';
}
export function personalizeSmart(value: string, data: Record<string, string>) {
  return value.replace(/{{\s*(empresa|contato|segmento|cidade|estado|email_empresa)\s*}}/g, (_, key: string) => data[key] || '');
}
export function csvCell(value: unknown) {
  let text = String(value ?? '').replace(/[\r\n]+/g, ' ');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function recoverSmartStatus(messageStatus?: string | null, cancelled = false) {
  if (messageStatus === 'SENT') return 'SENT';
  if (messageStatus === 'FAILED') return 'FAILED';
  if (!messageStatus || ['PREPARED', 'RETRYABLE'].includes(messageStatus)) return cancelled ? 'SKIPPED' : 'PENDING';
  return 'UNCERTAIN';
}
