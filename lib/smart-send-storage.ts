import { storageConfig } from './attachment-storage';
import { SmartSendError, smartLimits } from './smart-send-policy';
export const SMART_DELETE_MAX_FILES = 5;
export function smartDeletionLimit() {
  const value = Number(storageConfig('SMART_SEND_DELETE_FILES'));
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, SMART_DELETE_MAX_FILES) : SMART_DELETE_MAX_FILES;
}
export async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) throw new SmartSendError('Arquivo vazio.');
  const reader = body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) throw new SmartSendError('Arquivo excede o limite.', 413); chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { await reader.cancel().catch(() => {}); }
}
export const contentHash = async (bytes: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))).toString('hex');
export function smartStorage() {
  const url = storageConfig('SUPABASE_URL'), token = storageConfig('SUPABASE_SERVICE_ROLE_KEY'), bucket = storageConfig('SMART_SEND_BUCKET');
  if (!url || !token || !bucket) throw new SmartSendError('Configure o bucket privado de Envios Inteligentes.', 503);
  const base = url.replace(/\/$/, '') + '/storage/v1/object';
  const headers = { authorization: `Bearer ${token}`, apikey: token };
  const ensurePrivate = async () => {
    const r = await fetch(url.replace(/\/$/, '') + '/storage/v1/bucket/' + encodeURIComponent(bucket), { headers, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const data = await r.json().catch(() => null) as { public?: unknown } | null;
    if (!r.ok || data?.public !== false) throw new SmartSendError('O bucket de documentos deve existir e ser privado.', 503);
  };
  const path = (key: string) => { if (!/^smart-sends\/[0-9a-f-]{36}\.pdf$/.test(key)) throw new SmartSendError('Chave de arquivo inválida.'); return encodeURIComponent(bucket) + '/' + key; };
  return {
    async removeMany(keys: string[]): Promise<string[]> {
      const unique = [...new Set(keys)];
      if (!unique.length) return [];
      if (keys.length > SMART_DELETE_MAX_FILES) throw new SmartSendError('Grupo de exclusão excede o limite.');
      unique.forEach(path); // Validate the whole group before issuing any request.
      await ensurePrivate();
      const signal = AbortSignal.timeout(15_000);
      const response = await fetch(base + '/' + encodeURIComponent(bucket), { method: 'DELETE', redirect: 'manual',
        headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: unique }), signal });
      if (!response.ok) { await response.body?.cancel(); throw new Error('SMART_STORAGE_DELETE_FAILED'); }
      const result: unknown = JSON.parse(new TextDecoder().decode(await boundedBytes(response.body, 64 * 1024)));
      if (!Array.isArray(result) || result.some(row => !row || typeof row.name !== 'string' || !unique.includes(row.name))) throw new Error('SMART_STORAGE_DELETE_UNCONFIRMED');
      const confirmed = new Set<string>(result.map(row => row.name));
      // A retry may find objects already deleted after a lost acknowledgement.
      // Missing entries in a 2xx response alone are NOT proof of removal.
      for (const key of unique) {
        if (confirmed.has(key)) continue;
        try {
          const check = await fetch(base + '/info/' + path(key), { headers, redirect: 'manual', signal });
          if (![400, 404].includes(check.status)) { await check.body?.cancel(); continue; }
          const error = JSON.parse(new TextDecoder().decode(await boundedBytes(check.body, 4096))) as { code?: string; error?: string; message?: string };
          if (error.code === 'NoSuchKey' || (['not_found', 'Not Found'].includes(error.error || '') && error.message === 'Object not found')) confirmed.add(key);
        } catch { /* Preserve unconfirmed keys for a later invocation. */ }
      }
      return unique.filter(key => confirmed.has(key));
    },
    async put(key: string, bytes: Uint8Array) {
      await ensurePrivate();
      const r = await fetch(base + '/' + path(key), { method: 'POST', redirect: 'manual', headers: { ...headers, 'content-type': 'application/pdf', 'x-upsert': 'false' }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(30_000) });
      await r.body?.cancel(); if (!r.ok) throw new SmartSendError('Armazenamento não confirmado. Reconcilie a importação antes de tentar recuperar.', 503);
    },
    async get(key: string) {
      await ensurePrivate();
      const r = await fetch(base + '/authenticated/' + path(key), { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      if (!r.ok) { await r.body?.cancel(); throw new SmartSendError('PDF indisponível no armazenamento.', r.status === 404 ? 404 : 503); }
      return boundedBytes(r.body, smartLimits(storageConfig).fileBytes);
    },
    async remove(key: string) {
      path(key);
      const r = await fetch(base + '/' + encodeURIComponent(bucket), { method: 'DELETE', redirect: 'manual', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }), signal: AbortSignal.timeout(15_000) });
      await r.body?.cancel(); if (!r.ok) throw new Error('SMART_STORAGE_DELETE_FAILED');
    },
  };
}
