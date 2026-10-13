import { z } from 'zod';
import { type ImportResult } from './smart-import-protocol';
import { validateSmartFile, type SmartLimits } from './smart-send-policy';

const resultSchema = z.object({ documentId: z.string().uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), persistence: z.literal('persisted'),
  storage: z.enum(['stored', 'pending', 'duplicate', 'deleted']), analysis: z.enum(['complete', 'failed', 'pending']),
  code: z.string().nullable(), message: z.string(), recoverable: z.boolean() }).superRefine((r, ctx) => {
  if ((r.storage === 'pending' && r.analysis === 'complete') || (r.recoverable && ['deleted', 'duplicate'].includes(r.storage))) ctx.addIssue({ code: 'custom', message: 'Estado inconsistente' });
});
export class ImportRequestError extends Error {
  constructor(message: string, readonly status = 0, readonly code = 'CONNECTION_FAILED') { super(message); }
}
const httpMessage = (status: number) => status === 401 || status === 403 ? 'Sessão expirada ou acesso negado. Entre novamente antes de recuperar a fila.'
  : status === 413 ? 'PDF excede o limite da requisição.' : status === 429 ? 'Limite de requisições atingido. Aguarde antes de recuperar a fila.'
  : status === 408 || status === 504 ? 'Tempo esgotado. Reconcilie a importação.' : status >= 500 ? 'Serviço indisponível. O estado da importação precisa ser conferido.' : 'Não foi possível concluir a operação.';
export function decodeResponse(status: number, contentType: string | null, text: string): unknown {
  if (status === 401 || status === 403) throw new ImportRequestError(httpMessage(status), status, 'AUTH_REQUIRED');
  if (!/^application\/json(?:\s*;|$)/i.test(contentType || '')) throw new ImportRequestError('Resposta inesperada do servidor. Confira sua sessão e reconcilie a fila.', status, 'INVALID_RESPONSE');
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new ImportRequestError('Resposta JSON inválida. Reconcilie a fila.', status, 'INVALID_RESPONSE'); }
  if (status < 200 || status >= 300) {
    const safe = z.object({ code: z.enum(['AUTH_REQUIRED', 'SERVICE_UNAVAILABLE', 'REQUEST_REJECTED']), error: z.string().max(500) }).safeParse(body);
    throw new ImportRequestError(safe.success ? safe.data.error : httpMessage(status), status, safe.success ? safe.data.code : 'HTTP_ERROR');
  }
  return body;
}
export async function smartJson<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  try {
    const r = await fetch('/api/smart-sends' + path, { cache: 'no-store', signal: AbortSignal.timeout(30_000),
      ...(body === undefined ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    return decodeResponse(r.status, r.headers.get('content-type'), await r.text()) as T;
  } catch (error) {
    if (error instanceof ImportRequestError) throw error;
    throw new ImportRequestError('Falha de conexão ou tempo esgotado. Reconcilie a fila antes de continuar.');
  }
}
export async function importSnapshot(batchId: number) {
  const body = await smartJson<unknown>(`/${batchId}/import-status`);
  const parsed = z.object({ batchId: z.literal(batchId), items: z.array(resultSchema) }).safeParse(body);
  if (!parsed.success) throw new ImportRequestError('Não foi possível verificar os documentos do lote.', 200, 'INVALID_RESPONSE');
  return parsed.data.items;
}
export function uploadPdf(batchId: number, entry: ImportEntry, file: File, recover: boolean, progress: (value: number) => void): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', `/api/smart-sends/${batchId}/upload`); xhr.timeout = 120_000;
    xhr.setRequestHeader('content-type', 'application/pdf'); xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-upload-id', entry.id); if (recover) xhr.setRequestHeader('x-recover-upload', 'true');
    xhr.upload.onprogress = e => progress(e.lengthComputable ? Math.round(e.loaded / e.total * 100) : 0);
    xhr.onload = () => {
      try {
        const parsed = resultSchema.safeParse(decodeResponse(xhr.status, xhr.getResponseHeader('content-type'), xhr.responseText));
        if (!parsed.success || parsed.data.documentId !== entry.id || parsed.data.contentHash !== entry.hash) throw new ImportRequestError('Confirmação de persistência inválida. Reconcilie a fila.', xhr.status, 'INVALID_RESPONSE');
        resolve(parsed.data);
      } catch (error) { reject(error); }
    };
    xhr.onerror = () => reject(new ImportRequestError('Conexão interrompida. O resultado será conferido no servidor.'));
    xhr.ontimeout = () => reject(new ImportRequestError('Tempo esgotado. O resultado será conferido no servidor.', 408, 'TIMEOUT'));
    xhr.onabort = () => reject(new ImportRequestError('Upload interrompido. Reconcilie a fila.'));
    xhr.send(file);
  });
}
const entrySchema = z.object({ id: z.string().uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), name: z.string().max(180), size: z.number().int().nonnegative(),
  progress: z.number().min(0).max(100), phase: z.enum(['queued', 'sending', 'uncertain', 'confirmed', 'rejected']), state: z.string(), result: resultSchema.optional() });
export type ImportEntry = z.infer<typeof entrySchema>;
const queueKey = (id: number) => `smart-import:v1:${id}`;
export function saveImportQueue(storage: Pick<Storage, 'setItem'>, batchId: number, entries: ImportEntry[]) {
  storage.setItem(queueKey(batchId), JSON.stringify(entries));
}
export function restoreImportQueue(storage: Pick<Storage, 'getItem'>, batchId: number): ImportEntry[] {
  const raw = storage.getItem(queueKey(batchId)); if (!raw) return [];
  const entries = z.array(entrySchema).max(500).parse(JSON.parse(raw));
  return entries.map(e => e.phase === 'sending' ? { ...e, phase: 'uncertain', state: 'Importação interrompida. Reconcilie antes de continuar.' } : e);
}
export async function identifyFile(file: File, limits: SmartLimits) {
  validateSmartFile(file, limits);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
}
type QueueIO = {
  snapshot: () => Promise<ImportResult[]>;
  send: (entry: ImportEntry, recover: boolean, progress: (value: number) => void) => Promise<ImportResult>;
  hasFile: (entry: ImportEntry) => boolean;
  changed: (entries: ImportEntry[]) => void;
  sync: () => Promise<unknown>;
};
// The queue has no React dependency so failure/reload behavior is exercised directly.
export async function processImportQueue(input: ImportEntry[], io: QueueIO, recover = false) {
  const entries = input.map(e => ({ ...e }));
  let warning = '', failures = 0;
  const publish = () => io.changed(entries.map(e => ({ ...e })));
  const accept = (e: ImportEntry, result: ImportResult) => {
    e.id = result.documentId; e.result = result; e.progress = result.storage === 'stored' ? 100 : 0;
    e.phase = result.recoverable ? 'uncertain' : 'confirmed'; e.state = result.message;
  };
  try {
    let snapshot = await io.snapshot();
    for (const entry of entries) {
      if (entry.phase === 'rejected' || !entry.hash) continue;
      const existing = snapshot.find(r => r.documentId === entry.id) || snapshot.find(r => r.contentHash === entry.hash && r.storage !== 'deleted');
      if (existing) {
        if (existing.contentHash !== entry.hash) throw new ImportRequestError('O registro encontrado não corresponde ao PDF selecionado. Confira o lote.', 409, 'HASH_MISMATCH');
        if (!existing.recoverable || !recover) {
          const reused = existing.documentId !== entry.id;
          accept(entry, existing);
          if (reused) entry.state = 'Conteúdo já registrado neste lote. ' + existing.message;
          publish(); continue;
        }
        entry.result = existing;
      }
      if (!io.hasFile(entry)) { entry.state = 'Selecione novamente este PDF para recuperar a importação.'; publish(); continue; }
      entry.phase = 'sending'; entry.state = existing ? 'Recuperando documento salvo…' : 'Enviando arquivo…'; publish();
      try {
        const result = await io.send(entry, !!existing, value => { entry.progress = value; entry.state = value === 100 ? 'Aguardando confirmação de persistência e análise…' : 'Enviando arquivo…'; publish(); });
        if (result.contentHash !== entry.hash) throw new ImportRequestError('Hash de confirmação inválido.', 200, 'INVALID_RESPONSE');
        accept(entry, result); snapshot = [...snapshot.filter(r => r.documentId !== result.documentId), result];
        failures = result.recoverable ? failures + 1 : 0; publish();
        if (failures >= 2) { warning = 'Falhas persistentes no processamento. Recupere a fila quando o serviço estiver disponível.'; break; }
      } catch (error) {
        entry.phase = 'uncertain'; entry.state = error instanceof Error ? error.message : 'Resultado incerto.'; publish();
        const failure = error instanceof ImportRequestError ? error : new ImportRequestError(entry.state);
        if ([401, 403, 429].includes(failure.status) || failure.code === 'INVALID_RESPONSE') { warning = failure.message; break; }
        snapshot = await io.snapshot();
        const saved = snapshot.find(r => r.documentId === (entry.result?.documentId || entry.id));
        if (saved && saved.contentHash !== entry.hash) throw new ImportRequestError('O registro encontrado não corresponde ao PDF selecionado.', 409, 'HASH_MISMATCH');
        if (saved) accept(entry, saved);
        else if ([400, 413, 422].includes(failure.status)) { entry.phase = 'rejected'; entry.state = failure.message; }
        publish();
        if (!saved && entry.phase !== 'rejected') { warning = 'Resultado ainda incerto. A fila restante foi preservada; use Recuperar pendentes.'; break; }
        if (failure.status >= 500 && ++failures >= 2) { warning = 'Serviço indisponível repetidamente. A fila restante foi preservada.'; break; }
      }
    }
  } catch (error) { warning = error instanceof Error ? error.message : 'Não foi possível reconciliar a fila.'; }
  // A visual refresh can never invalidate the upload results or stop the loop above.
  try { await io.sync(); } catch { warning ||= 'Importação registrada. Falha ao atualizar a tela; use Atualizar para sincronizar.'; }
  return { entries, warning };
}
