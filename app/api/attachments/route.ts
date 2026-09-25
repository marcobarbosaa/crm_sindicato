import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { templateAttachments } from "@/db/schema";
import { ATTACHMENT_LIMITS, AttachmentError, validateAttachment, validateAttachmentSet } from "@/lib/attachments";
import { attachmentStorage } from "@/lib/attachment-storage";
import { attachmentMetadata } from "@/lib/attachment-service";
const MAX_REQUEST = ATTACHMENT_LIMITS.totalBytes + 256 * 1024;
async function boundedForm(request: NextRequest) {
  if (Number(request.headers.get("content-length")) > MAX_REQUEST) throw new AttachmentError("O upload ultrapassa 12 MB.");
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) throw new AttachmentError("Envie os arquivos como formulário.");
  const reader = request.body?.getReader();
  if (!reader) throw new AttachmentError("Selecione arquivos para adicionar.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_REQUEST) { await reader.cancel(); throw new AttachmentError("O upload ultrapassa 12 MB."); }
      chunks.push(new Uint8Array(part.value));
    }
  } finally { reader.releaseLock(); }
  return new Response(new Blob(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
}
async function checkSignature(file: File, mimeType: string) {
  const bytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const starts = (prefix: number[]) => prefix.every((value, i) => bytes[i] === value);
  const valid = mimeType === "application/pdf" ? starts([37, 80, 68, 70, 45])
    : mimeType === "image/png" ? starts([137, 80, 78, 71, 13, 10, 26, 10])
    : mimeType === "image/jpeg" ? starts([255, 216, 255])
    : mimeType.includes("openxmlformats") ? starts([80, 75, 3, 4])
    : !bytes.includes(0);
  if (!valid) throw new AttachmentError(file.name + ": o conteúdo não corresponde ao formato informado.");
}
export async function POST(request: NextRequest) {
  try {
    const form = await boundedForm(request), entries = form.getAll("files");
    if (!entries.length || entries.some(file => !(file instanceof File))) throw new AttachmentError("Selecione arquivos válidos.");
    const files = entries as File[];
    validateAttachmentSet(files);
    const metadata = files.map(validateAttachment);
    for (let i = 0; i < files.length; i++) await checkSignature(files[i], metadata[i].mimeType);
    const storage = attachmentStorage(), db = getDb(), result = [];
    for (let i = 0; i < files.length; i++) {
      const id = crypto.randomUUID(), now = new Date();
      // Register first: crashes/timeouts leave uploaded objects tracked for cleanup.
      const [row] = await db.insert(templateAttachments).values({
        id, ownerId: "local-preview-user", ...metadata[i], storageKey: "attachments/" + id,
        createdAt: now, expiresAt: new Date(now.getTime() + ATTACHMENT_LIMITS.draftHours * 3600_000),
      }).returning();
      await storage.put(row.storageKey, new Blob([files[i]], { type: row.mimeType }));
      await db.update(templateAttachments).set({ ready: true }).where(eq(templateAttachments.id, id));
      result.push(attachmentMetadata(row));
    }
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof AttachmentError ? error.message : "Falha no upload. Verifique o armazenamento de anexos e tente novamente." }, { status: error instanceof AttachmentError ? 400 : 503 });
  }
}
