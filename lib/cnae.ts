/**
 * CNAE storage shared by BrasilAPI (one company) and Receita open-data (bulk).
 * Only activity codes/descriptions are retained; no PII from the source payload.
 */
export type CnaeEntry = { code: string; description: string };
export type CnaeSnapshot = {
  cnpj: string;
  principal: CnaeEntry;
  secondaries: CnaeEntry[];
  source: "BRASILAPI" | "RECEITA";
  reference: string | null;
};

export function normalizeCnae(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\d{7}$/.test(raw) && !/^\d{2}\.\d{2}-\d\/\d{2}$/.test(raw)) return null;
  return raw.replace(/\D/g, "");
}

/** Parses a comma/semicolon separated spreadsheet field of CNAE codes. */
export function parseCnaeCodes(value: unknown): string[] | null {
  const input = String(value ?? "").trim();
  if (!input) return [];
  const parts = input.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean);
  if (parts.length > 200) return null;
  const result: string[] = [];
  for (const item of parts) {
    const code = normalizeCnae(item);
    if (!code) return null;
    if (!result.includes(code)) result.push(code);
  }
  return result;
}

export function normalizeCnpjForLookup(value: unknown): string | null {
  const normalized = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{12}\d{2}$/.test(normalized) ? normalized : null;
}

function entry(code: unknown, description: unknown): CnaeEntry | null {
  const normalized = normalizeCnae(code);
  if (!normalized) return null;
  return { code: normalized, description: String(description ?? "").trim().slice(0, 400) };
}

export function normalizeSnapshot(input: unknown): CnaeSnapshot {
  if (!input || typeof input !== "object") throw new Error("Resposta CNAE inválida.");
  const data = input as Record<string, unknown>;
  const cnpj = normalizeCnpjForLookup(data.cnpj);
  const rawPrincipal = data.principal as Record<string, unknown> | null;
  const principal = rawPrincipal && entry(rawPrincipal.code, rawPrincipal.description);
  if (!cnpj || !principal) throw new Error("CNPJ ou CNAE principal inválido.");
  const seen = new Set([principal.code]);
  const secondaryInput = Array.isArray(data.secondaries) ? data.secondaries : [];
  if (secondaryInput.length > 200) throw new Error("Quantidade de CNAEs secundários inválida.");
  const secondaries: CnaeEntry[] = [];
  for (const item of secondaryInput) {
    if (!item || typeof item !== "object") throw new Error("CNAE secundário inválido.");
    const raw = item as Record<string, unknown>;
    const activity = entry(raw.code, raw.description);
    if (!activity) throw new Error("Código de CNAE secundário inválido.");
    if (!seen.has(activity.code)) { secondaries.push(activity); seen.add(activity.code); }
  }
  const source = data.source;
  if (source !== "RECEITA" && source !== "BRASILAPI") throw new Error("Fonte CNAE inválida.");
  const reference = typeof data.reference === "string" ? data.reference.trim().slice(0, 32) : null;
  return { cnpj, principal, secondaries, source, reference };
}

export async function lookupBrasilApi(cnpj: string): Promise<CnaeSnapshot> {
  const normalized = normalizeCnpjForLookup(cnpj);
  if (!normalized) throw new Error("CNPJ inválido para consulta.");
  // The host is constant and never user-controlled (prevents SSRF).
  const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${normalized}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok) {
    // Do not leak provider response bodies into logs/clients.
    if (response.status === 404) throw new Error("CNPJ não encontrado na fonte consultada.");
    if (response.status === 429) throw new Error("Limite de consultas da fonte atingido. Tente mais tarde.");
    throw new Error("Consulta CNAE temporariamente indisponível.");
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > 250_000) throw new Error("Resposta CNAE acima do limite esperado.");
  const raw = await response.text();
  if (raw.length > 250_000) throw new Error("Resposta CNAE acima do limite esperado.");
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error("Formato de resposta da fonte inválido."); }
  if (normalizeCnpjForLookup(data.cnpj) !== normalized) throw new Error("Fonte retornou CNPJ diferente do solicitado.");
  return normalizeSnapshot({
    cnpj: normalized,
    principal: { code: data.cnae_fiscal, description: data.cnae_fiscal_descricao },
    secondaries: Array.isArray(data.cnaes_secundarios)
      ? data.cnaes_secundarios.map((item: {codigo?: unknown; descricao?: unknown}) => ({ code: item.codigo, description: item.descricao }))
      : [],
    source: "BRASILAPI",
    reference: null,
  });
}
