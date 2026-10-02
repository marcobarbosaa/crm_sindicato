import { SendFailure, runtimeFailure } from "./send-diagnostics";
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
  const url = storageConfig("SUPABASE_URL"), token = storageConfig("SUPABASE_SERVICE_ROLE_KEY"), bucket = storageConfig("SUPABASE_ATTACHMENTS_BUCKET") || storageConfig("SUPABASE_ATTACHMENT_BUCKET");
  if (!url || !token || !bucket) throw new SendFailure("ATTACHMENT_FAILURE", "STORAGE_CONFIGURATION");
  const base = url.replace(/\/$/, "") + "/storage/v1/object";
  const headers = { authorization: "Bearer " + token, apikey: token };
  const path = (key: string) => encodeURIComponent(bucket) + "/" + key.split("/").map(encodeURIComponent).join("/");
  return {
    async put(key, file) {
      const r = await fetch(base + "/" + path(key), { method: "POST", redirect: "manual", headers: { ...headers, "content-type": file.type, "x-upsert": "false" }, body: file, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error("Não foi possível armazenar o anexo. Verifique a configuração do bucket.");
    },
    async get(key) {
      try {
        const r = await fetch(base + "/authenticated/" + path(key), { headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
        // workerd does not support redirect:"error"; manual never forwards credentials.
        if (r.status >= 300 && r.status < 400) throw new SendFailure("ATTACHMENT_FAILURE", "STORAGE_REDIRECT_REJECTED", 503, r.status);
        if (!r.ok) throw new SendFailure("ATTACHMENT_FAILURE",
          r.status === 404 ? "STORAGE_NOT_FOUND" : r.status === 401 || r.status === 403 ? "STORAGE_ACCESS_DENIED" : r.status === 429 ? "STORAGE_RATE_LIMIT" : "STORAGE_HTTP_FAILURE", 503, r.status);
        return new Uint8Array(await r.arrayBuffer());
      } catch (error) {
        if (error instanceof SendFailure) throw error;
        const runtime = runtimeFailure(error);
        if (runtime) throw runtime;
        throw new SendFailure("ATTACHMENT_FAILURE", error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "STORAGE_TIMEOUT" : "STORAGE_TRANSPORT_FAILURE");
      }
    },
    async remove(key) {
      const r = await fetch(base + "/" + encodeURIComponent(bucket), { method: "DELETE", redirect: "manual", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [key] }), signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error("Não foi possível limpar o anexo no armazenamento.");
    },
  };
}
