#!/usr/bin/env node
/**
 * LOCAL administrator-only Receita CNAE sync; NEVER run inside a Worker.
 *
 * Export target CNPJs:
 *   DATABASE_URL=... node scripts/sync-receita-cnaes.mjs --owner local-preview-user --export-targets targets.csv
 * Dry-run:
 *   DATABASE_URL=... node scripts/sync-receita-cnaes.mjs --owner local-preview-user --apply matches.jsonl
 * Explicit write:
 *   DATABASE_URL=... node scripts/sync-receita-cnaes.mjs --owner local-preview-user --apply matches.jsonl --confirm
 */
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { once } from "node:events";
import postgres from "postgres";

const args = process.argv.slice(2);
const option = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const owner = option("--owner");
const exportFile = option("--export-targets");
const inputFile = option("--apply");
const confirmed = args.includes("--confirm");
if (!owner || owner.startsWith("--") || Boolean(exportFile) === Boolean(inputFile) || (confirmed && !inputFile)) {
  console.error("Informe --owner e apenas --export-targets <csv> ou --apply <jsonl> [--confirm].");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não configurada; não é permitido executar sem identificar explicitamente o banco.");
  process.exit(2);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 8 });
const validCnpj = (v) => typeof v === "string" && /^[A-Z0-9]{12}[0-9]{2}$/.test(v);
const validCnae = (v) => typeof v === "string" && /^[0-9]{7}$/.test(v);
function checked(raw) {
  const cnpj = String(raw?.cnpj || "").toUpperCase();
  if (!validCnpj(cnpj) || raw?.source !== "RECEITA" || !/^20\d\d-(0[1-9]|1[0-2])$/.test(raw.reference || "")) throw Error("Cabeçalho CNAE inválido.");
  if (!validCnae(raw?.principal?.code) || typeof raw.principal.description !== "string") throw Error("CNAE principal inválido.");
  if (!Array.isArray(raw.secondaries) || raw.secondaries.length > 200) throw Error("CNAEs secundários inválidos.");
  const seen = new Set([raw.principal.code]);
  for (const item of raw.secondaries) {
    if (!validCnae(item.code) || typeof item.description !== "string" || seen.has(item.code)) throw Error("CNAE secundário inválido/duplicado.");
    seen.add(item.code);
  }
  return { cnpj, principal: raw.principal, secondaries: raw.secondaries, reference: raw.reference };
}
async function execute() {
  const info = await sql`select current_database() as database, current_user as db_user`;
  console.log(`Banco: ${info[0].database}; role: ${info[0].db_user}; proprietário CRM: ${owner}`);
  if (exportFile) {
    const stream = createWriteStream(exportFile, { flags: "wx" });
    let count = 0;
    try {
      stream.write("cnpj\n");
      const rows = await sql`select distinct cnpj from public.companies
        where owner_id = ${owner} and cnpj is not null order by cnpj`;
      for (const row of rows) {
        const cnpj = String(row.cnpj).replace(/[^A-Z0-9]/gi, "").toUpperCase();
        if (!validCnpj(cnpj)) continue;
        if (!stream.write(cnpj + "\n")) await once(stream, "drain");
        count++;
      }
      stream.end(); await once(stream, "finish");
    } catch (e) { stream.destroy(); throw e; }
    console.log(`CNPJs exportados: ${count}. Este arquivo deve permanecer privado.`);
    return;
  }
  let checkedCount = 0, updated = 0, skipped = 0;
  const seen = new Set();
  async function* records() {
    const read = createInterface({ input: createReadStream(inputFile, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of read) {
      if (!line.trim()) continue;
      if (line.length > 50_000) throw Error("Linha JSONL excessivamente longa.");
      yield checked(JSON.parse(line));
    }
  }
  // Validate ALL records first, before permitting any database writes.
  for await (const value of records()) {
    if (seen.has(value.cnpj)) throw Error("CNPJ duplicado no JSONL.");
    seen.add(value.cnpj);
    checkedCount++;
  }
  if (confirmed) for await (const value of records()) {
    // Does not overwrite records fetched from BrasilAPI.
    const now = Date.now();
    const result = await sql`update public.companies
      set cnae_primary_code = ${value.principal.code},
          cnae_primary_description = ${value.principal.description.slice(0, 400)},
          cnae_secondaries = ${JSON.stringify(value.secondaries)}::jsonb,
          cnae_source = 'RECEITA',
          cnae_reference = ${value.reference},
          cnae_synced_at = ${now},
          updated_at = ${now}
      where owner_id = ${owner} and cnpj = ${value.cnpj}
        and (cnae_source is distinct from 'BRASILAPI')
      returning id`;
    if (result.length) updated += result.length;
    else skipped++;
  }
  console.log(confirmed
    ? `Sincronização concluída: ${checkedCount} linhas, ${updated} empresas atualizadas, ${skipped} não aplicadas.`
    : `Simulação concluída: ${checkedCount} linhas válidas. Nenhuma alteração. Use --confirm para aplicar.`);
}
try { await execute(); }
catch (error) { console.error("Falha na sincronização:", error.message); process.exitCode = 1; }
finally { await sql.end({ timeout: 2 }); }
