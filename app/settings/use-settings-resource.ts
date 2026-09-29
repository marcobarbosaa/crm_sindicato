import { useCallback, useEffect, useState } from "react";

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(data?.error || "Não foi possível consultar o servidor. Tente novamente.");
  }
  return response.json() as Promise<T>;
}
export function useSettingsResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setError("");
      try {
        const result = await requestJson<T>(url, { signal: controller.signal });
        if (!controller.signal.aborted) setData(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao carregar.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [url, revision]);
  return { data, setData, error, loading, reload };
}
