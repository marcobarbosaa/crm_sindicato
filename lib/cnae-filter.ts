import { eq, or, sql } from "drizzle-orm";
import { companies } from "@/db/schema";
import { normalizeCnae } from "@/lib/cnae";

/** Shared SQL predicate for lists, audience previews, and campaign preparation. */
export function cnaeMatches(code: string, scope: "any" | "principal" = "any") {
  const normalized = normalizeCnae(code);
  if (!normalized) throw new Error("Código CNAE inválido.");
  return scope === "principal"
    ? eq(companies.cnaePrimaryCode, normalized)
    : or(eq(companies.cnaePrimaryCode, normalized),
      sql`${companies.cnaeSecondaries} @> ${JSON.stringify([{ code: normalized }])}::jsonb`);
}
