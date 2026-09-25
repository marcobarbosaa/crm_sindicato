export type Attachment = { id: string; name: string; mimeType: string; size: number };
export const ATTACHMENT_LIMITS = { count: 10, fileBytes: 8 * 1024 * 1024, totalBytes: 12 * 1024 * 1024, draftHours: 24 };
export const ATTACHMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export class AttachmentError extends Error {}
export function validateAttachment(file: { name: string; type: string; size: number }) {
  const name = file.name.normalize("NFC").trim();
  if (!name || name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(name) || name === "." || name === "..") throw new AttachmentError("Nome de arquivo inválido (máximo de 180 caracteres, sem caminhos).");
  const mimeType = ATTACHMENT_TYPES[name.split(".").pop()?.toLowerCase() || ""];
  if (!mimeType) throw new AttachmentError(name + ": formato não permitido. Use PDF, TXT, CSV, PNG, JPG, DOCX, XLSX ou PPTX.");
  if (file.type && file.type !== mimeType && file.type !== "application/octet-stream") throw new AttachmentError(name + ": o tipo do arquivo não corresponde à extensão.");
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > ATTACHMENT_LIMITS.fileBytes) throw new AttachmentError(name + ": o arquivo deve ter conteúdo e no máximo 8 MB.");
  return { name, mimeType, size: file.size };
}
export function validateAttachmentSet(files: { size: number }[]) {
  if (files.length > ATTACHMENT_LIMITS.count) throw new AttachmentError("Adicione no máximo 10 arquivos.");
  if (files.some(f => !Number.isSafeInteger(f.size) || f.size <= 0 || f.size > ATTACHMENT_LIMITS.fileBytes)) throw new AttachmentError("Cada arquivo deve ter conteúdo e no máximo 8 MB.");
  if (files.reduce((sum, file) => sum + file.size, 0) > ATTACHMENT_LIMITS.totalBytes) throw new AttachmentError("Os anexos devem somar no máximo 12 MB.");
}
export function attachmentIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > ATTACHMENT_LIMITS.count || value.some(id => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) || new Set(value).size !== value.length) throw new AttachmentError("Seleção de anexos inválida.");
  return value;
}
export function formatFileSize(size: number) { return size < 1024 * 1024 ? Math.ceil(size / 1024) + " KB" : (size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB"; }
