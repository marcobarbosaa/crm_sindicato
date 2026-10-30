import { test } from "node:test";
import assert from "node:assert/strict";
import { loader } from "./smart-test-loader.mjs";
const { normalizeCnae, normalizeCnpjForLookup, parseCnaeCodes, normalizeSnapshot, lookupBrasilApi } = loader()("lib/cnae.ts");

test("CNAE estrito, sem converter descrições em códigos", () => {
  assert.equal(normalizeCnae("47.11-3/02"), "4711302");
  assert.equal(normalizeCnae(4711302), "4711302");
  for (const value of ["mercado 4711302", "1234567abc", "1234", "00000000"]) assert.equal(normalizeCnae(value), null);
  assert.deepEqual(parseCnaeCodes("47.11-3/02; 6204000, 4711302"), ["4711302", "6204000"]);
  assert.equal(parseCnaeCodes("47.11-3/02; inválido"), null);
});

test("CNPJ mantém letras e zeros à esquerda", () => {
  assert.equal(normalizeCnpjForLookup(" 19.131.243/0001-97 "), "19131243000197");
  assert.equal(normalizeCnpjForLookup("AB.CDE.F12/0001-90"), "ABCDEF12000190");
  assert.equal(normalizeCnpjForLookup("123456"), null);
});

test("snapshot CNAE rejeita fontes inválidas e deduplica atividades", () => {
  const input={cnpj:"19131243000197",principal:{code:"4711302",description:"Mercado"},secondaries:[{code:"6204000",description:"TI"},{code:"6204000",description:"TI"}],source:"RECEITA",reference:"2026-10"};
  const normalized=normalizeSnapshot(input);
  assert.equal(normalized.secondaries.length,1);
  assert.equal(normalized.principal.code,"4711302");
  assert.throws(()=>normalizeSnapshot({...input,source:"DESCONHECIDA"}));
  assert.throws(()=>normalizeSnapshot({...input,principal:{code:"invalido"}}));
});

test("BrasilAPI busca só o CNPJ solicitado, retorna CNAEs sem dados pessoais", async () => {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async (url,options)=>{
      assert.equal(url,"https://brasilapi.com.br/api/cnpj/v1/19131243000197");
      assert.equal(options.cache,"no-store");
      return Response.json({cnpj:"19131243000197",cnae_fiscal:9430800,cnae_fiscal_descricao:"Associação",cnaes_secundarios:[{codigo:9493600,descricao:"Cultura"}],qsa:[{nome_socio:"NÃO DEVE SER RETIDO"}]});
    };
    const value=await lookupBrasilApi("19.131.243/0001-97");
    assert.equal(value.principal.code,"9430800");
    assert.equal(value.secondaries[0].code,"9493600");
    assert.equal(JSON.stringify(value).includes("nome_socio"),false);
    globalThis.fetch=async()=>Response.json({cnpj:"00000000000000",cnae_fiscal:9430800});
    await assert.rejects(lookupBrasilApi("19131243000197"),/diferente/);
    globalThis.fetch=async()=>new Response("indisponível",{status:503});
    await assert.rejects(lookupBrasilApi("19131243000197"),/indisponível/);
  } finally { globalThis.fetch=original; }
});
