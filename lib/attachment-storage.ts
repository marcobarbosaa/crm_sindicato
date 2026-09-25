import { env } from "cloudflare:workers";
export interface AttachmentStorage {
  put(key: string, file: Blob): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}
export function storageConfig(name: string) {
  return (env as unknown as Record<string, string | undefined>)[name] || process.env[name];
}
// Private persistent object storage; deliberately no filesystem fallback on Workers.
export function attachmentStorage(): AttachmentStorage {
  const url = storageConfig("SUPABASE_URL"), token = storageConfig("SUPABASE_SERVICE_ROLE_KEY"), bucket = storageConfig("SUPABASE_ATTACHMENTS_BUCKET");
  if (!url || !token || !bucket) throw new Error("Armazenamento de anexos não configurado. Configure o bucket privado do Supabase.");
  const base = url.replace(/\/$/, "") + "/storage/v1/object";
  const headers = { authorization: "Bearer " + token, apikey: token };
  const path = (key: string) => encodeURIComponent(bucket) + "/" + key.split("/").map(encodeURIComponent).join("/");
  return {
    async put(key, file) {
      const r = await fetch(base + "/" + path(key), { method: "POST", headers: { ...headers, "content-type": file.type, "x-upsert": "false" }, body: file, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error("Não foi possível armazenar o anexo. Verifique a configuração do bucket.");
    },
    async get(key) {
      const r = await fetch(base + "/authenticated/" + path(key), { headers, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error("Não foi possível recuperar um anexo. Tente novamente.");
      return new Uint8Array(await r.arrayBuffer());
    },
    async remove(key) {
      const r = await fetch(base + "/" + encodeURIComponent(bucket), { method: "DELETE", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [key] }), signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error("Não foi possível limpar o anexo no armazenamento.");
    },
  };
}
