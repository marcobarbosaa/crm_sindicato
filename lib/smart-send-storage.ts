import { storageConfig } from './attachment-storage';
import { SmartSendError, smartLimits } from './smart-send-policy';
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
    async put(key: string, bytes: Uint8Array) {
      await ensurePrivate();
      const r = await fetch(base + '/' + path(key), { method: 'POST', redirect: 'manual', headers: { ...headers, 'content-type': 'application/pdf', 'x-upsert': 'false' }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(30_000) });
      await r.body?.cancel(); if (!r.ok) throw new SmartSendError('Falha no upload. Remova o item e importe novamente.', 503);
    },
    async get(key: string) {
      await ensurePrivate();
      const r = await fetch(base + '/authenticated/' + path(key), { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      if (!r.ok) { await r.body?.cancel(); throw new SmartSendError('PDF indisponível no armazenamento.', 503); }
      return boundedBytes(r.body, smartLimits(storageConfig).fileBytes);
    },
    async remove(key: string) {
      path(key);
      const r = await fetch(base + '/' + encodeURIComponent(bucket), { method: 'DELETE', redirect: 'manual', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }), signal: AbortSignal.timeout(15_000) });
      await r.body?.cancel(); if (!r.ok) throw new Error('SMART_STORAGE_DELETE_FAILED');
    },
  };
}
