#!/usr/bin/env node
// Real-route integration checks in ephemeral GitHub Actions PostgreSQL only.
// The CNPJ data and provider replies are fictitious. NO external calls or sends.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loader } from "./smart-test-loader.mjs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

const dsn = process.env.CNAE_TEST_DATABASE_URL;
if (!dsn) throw Error("Database URL missing");
const u = new URL(dsn);
if (!["127.0.0.1", "localhost", "postgres"].includes(u.hostname) || u.pathname !== "/cnae_test") {
  throw Error("Safety lock: tests require local ephemeral database cnae_test.");
}
const client = postgres(dsn, { max: 1, prepare: false, connect_timeout: 5 });
let db;
const load = loader({
  "next/server": { NextResponse: { json: (value, opts) => Response.json(value, opts) } },
  "@/db": { getDb: () => db },
  "@/lib/attachment-service": { loadSendAttachments: async () => [] },
});
const s = load("db/schema.ts");
db = drizzle(client, { schema: s });
const { companies, emailTemplates, emailCampaigns, emailCampaignRecipients } = s;
const stamp = new Date();
const makeReq = (path, method = "GET", body) => {
  const url = new URL(path, "http://localhost:5173");
  const req = new Request(url, method === "GET" ? {} : {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  req.nextUrl = url;
  return req;
};
const response = async (result, expected = 200) => {
  const data = await result.json();
  assert.equal(result.status, expected, JSON.stringify(data));
  return data;
};
const imports = load("app/api/imports/route.ts");
const list = load("app/api/companies/route.ts");
const lookup = load("app/api/companies/[id]/cnaes/route.ts");
const audience = load("app/api/email-campaigns/audience/route.ts");
const campaigns = load("app/api/email-campaigns/route.ts");
const prepare = load("app/api/email-campaigns/[id]/prepare/route.ts");
let passed = 0;
async function step(name, fn) {
  try { await fn(); console.log("PASS " + name); passed++; }
  catch (error) { console.error("FAIL " + name); throw error; }
}
const DDL = [
  "create table companies (id serial primary key, owner_id text not null, name text not null, trade_name text, cnpj text, website text, segment text, region integer, city text, state text, address text, phone text, phone_whatsapp_status text not null default 'UNKNOWN', mobile text, mobile_whatsapp_status text not null default 'UNKNOWN', primary_email text, primary_email_status text not null default 'UNKNOWN', primary_email_status_reason text, primary_email_status_updated_at bigint, employee_count integer, employee_range text, company_size text, notes text, status text not null default 'NOT_CONTACTED', last_contact_at bigint, next_follow_up_at bigint, created_at bigint not null, updated_at bigint not null, unique(owner_id,cnpj))",
  "create table contacts (id serial primary key, company_id integer not null references companies(id), name text, email text, phone text, role text, is_primary boolean not null default false, created_at bigint not null)",
  "create table activity_logs (id serial primary key, owner_id text not null, company_id integer references companies(id), type text not null, description text not null, created_at bigint not null)",
  "create table import_batches (id serial primary key, owner_id text not null, file_name text not null, total_rows integer not null, imported_rows integer not null, updated_rows integer not null default 0, skipped_rows integer not null default 0, error_rows integer not null default 0, created_at bigint not null)",
  "create table email_templates (id serial primary key, owner_id text not null, name text not null, subject text not null, body text not null, created_at bigint not null, updated_at bigint not null)",
  "create table email_campaigns (id serial primary key, owner_id text not null, name text not null, template_id integer references email_templates(id), status text not null default 'DRAFT', audience jsonb not null default '{}'::jsonb, total integer not null default 0, pending integer not null default 0, sent integer not null default 0, failed integer not null default 0, skipped integer not null default 0, batch_size integer not null default 25, interval_minutes integer not null default 10, next_run_at bigint, lock_until bigint, started_at bigint, completed_at bigint, delivery_monitoring_enabled boolean not null default true, delivery_next_check_at bigint, delivery_checked_at bigint, delivery_completed_at bigint, audience_without_email integer not null default 0, audience_invalid_email integer not null default 0, logical_batch jsonb, processing_notice text, created_at bigint not null, updated_at bigint not null)",
  "create table email_campaign_recipients (id serial primary key, campaign_id integer not null references email_campaigns(id), company_id integer references companies(id), contact_id integer references contacts(id), recipient text not null, company_name text not null, personalization jsonb not null default '{}'::jsonb, status text not null default 'PENDING', attempts integer not null default 0, processing_started_at bigint, message_id integer, error_message text, provider_message_id text, sent_at bigint, delivery_status text not null default 'PENDING', delivery_failure_category text, delivery_diagnostic_code text, delivery_error_message text, bounced_at bigint, bounce_message_id text, delivery_checked_at bigint, last_batch_id text, failure_category text, created_at bigint not null, updated_at bigint not null, unique(campaign_id,company_id))",
];
const rows = [
  { name:"Mercado A", cnpj:"19131243000197", primaryEmail:"a@example.test", cnaePrimaryCode:"47.11-3/02", cnaeSecondaryCodes:"6204000", region:"8", city:"Recife", employeeCount:"5", segment:"Comércio" },
  { name:"Empresa B", cnpj:"11111111000191", primaryEmail:"b@example.test", cnaePrimaryCode:"6204000", cnaeSecondaryCodes:"4711302", region:"8", city:"Recife", employeeCount:"20" },
  { name:"Empresa C", cnpj:"33333333000133", cnaePrimaryCode:"4711302", region:"9", city:"Olinda", employeeCount:"3" },
  { name:"Empresa D", cnpj:"44444444000144", primaryEmail:"d@example.test", region:"8", city:"Recife", employeeCount:"6" },
  { name:"Inválida", cnpj:"55555555000155", region:"8", cnaePrimaryCode:"texto livre" },
];
try {
  await step("Banco anterior ao CNAE e migração real idempotente", async () => {
    for (const statement of DDL) await client.unsafe(statement);
    const before = await client.unsafe("select column_name from information_schema.columns where table_name = 'companies' and column_name like 'cnae_%'");
    assert.equal(before.length, 0);
    const migration = readFileSync("supabase/migrations/20261030170000_company_cnaes.sql", "utf8");
    await client.unsafe(migration);
    await client.unsafe(migration);
    const after = await client.unsafe("select column_name from information_schema.columns where table_name = 'companies' and column_name like 'cnae_%'");
    assert.equal(after.length, 6);
    const indexes = await client.unsafe("select indexname from pg_indexes where tablename='companies' and indexname in ('idx_companies_owner_cnae_primary','idx_companies_cnae_secondaries_gin')");
    assert.equal(indexes.length, 2);
  });
  await step("Revisão CSV identifica 4 válidas e 1 inválida", async () => {
    const v = await response(await imports.POST(makeReq("/api/imports", "POST", { rows, preview: true })));
    assert.equal(v.ready, 4); assert.equal(v.errors, 1);
  });
  await step("Importação preserva região, porte e segmento legado", async () => {
    const v = await response(await imports.POST(makeReq("/api/imports", "POST", { rows, fileName:"fake.csv" })), 201);
    assert.equal(v.imported, 4); assert.equal(v.errors, 1);
    const [a] = await db.select().from(companies).where(eq(companies.cnpj, "19131243000197"));
    assert.equal(a.region, 8); assert.equal(a.companySize, "ME");
    assert.equal(a.segment, "Comércio"); assert.equal(a.cnaePrimaryCode, "4711302");
    assert.deepEqual(a.cnaeSecondaries, [{ code:"6204000", description:"" }]);
  });
  await step("BrasilAPI simulada atualiza banco, mantém legado, e cacheia", async () => {
    const [a] = await db.select().from(companies).where(eq(companies.cnpj, "19131243000197"));
    const original = globalThis.fetch; let count = 0;
    try {
      globalThis.fetch = async (url) => {
        assert.equal(String(url), "https://brasilapi.com.br/api/cnpj/v1/19131243000197");
        count++;
        return Response.json({ cnpj:"19131243000197", cnae_fiscal:4711302, cnae_fiscal_descricao:"Comércio", cnaes_secundarios:[{codigo:6204000,descricao:"Consultoria"}] });
      };
      const ctx = { params: Promise.resolve({ id:String(a.id) }) };
      const updated = await response(await lookup.POST(makeReq("/api/companies/"+a.id+"/cnaes", "POST"), ctx));
      assert.equal(updated.company.cnaeSource, "BRASILAPI");
      const cached = await response(await lookup.POST(makeReq("/api/companies/"+a.id+"/cnaes", "POST"), ctx));
      assert.equal(cached.cached, true); assert.equal(count, 1);
      const [after] = await db.select().from(companies).where(eq(companies.id,a.id));
      assert.equal(after.segment, "Comércio"); assert.equal(after.cnaeSecondaries[0].description,"Consultoria");
      assert.equal((await lookup.POST(makeReq("/api/companies/999999/cnaes","POST"), { params: Promise.resolve({ id:"999999" }) })).status,404);
    } finally { globalThis.fetch = original; }
  });
  await step("HTTP 429 da BrasilAPI preserva cadastro e informa Retry-After", async () => {
    const [d] = await db.select().from(companies).where(eq(companies.name, "Empresa D"));
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response("Bloqueado temporariamente", {
        status: 429, headers: { "Retry-After": "120" },
      });
      const res = await lookup.POST(
        makeReq("/api/companies/" + d.id + "/cnaes", "POST"),
        { params: Promise.resolve({ id:String(d.id) }) },
      );
      const payload = await response(res, 429);
      assert.equal(payload.retryAfterSeconds, 120);
      assert.equal(res.headers.get("Retry-After"), "120");
      const [still] = await db.select().from(companies).where(eq(companies.id, d.id));
      assert.equal(still.cnaePrimaryCode, null);
      assert.equal(still.cnaeSource, null);
    } finally { globalThis.fetch = original; }
  });
  await step("Planilha posterior não sobrescreve CNAE verificado", async () => {
    const v = await response(await imports.POST(makeReq("/api/imports","POST",{ rows:[{ ...rows[0],cnaePrimaryCode:"9999999",cnaeSecondaryCodes:""}],duplicateStrategy:"update" })),201);
    assert.equal(v.updated,1);
    const [a] = await db.select().from(companies).where(eq(companies.cnpj,"19131243000197"));
    assert.equal(a.cnaePrimaryCode,"4711302"); assert.equal(a.cnaeSource,"BRASILAPI");
  });
  await step("Filtros principal/secundário/pendente", async () => {
    const root="/api/companies?mode=page&page=1";
    const primary=await response(await list.GET(makeReq(root+"&cnae=4711302&cnaeScope=principal")));
    const any=await response(await list.GET(makeReq(root+"&cnae=4711302&cnaeScope=any")));
    const pending=await response(await list.GET(makeReq(root+"&cnaeStatus=without")));
    assert.equal(primary.total,2); assert.equal(any.total,3); assert.equal(pending.total,1);
  });
  await step("Prévia de campanha distingue empresa com e-mail inválido", async () => {
    const [b]=await db.select().from(companies).where(eq(companies.name,"Empresa B"));
    await db.update(companies).set({primaryEmailStatus:"INVALID"}).where(eq(companies.id,b.id));
    const v=await response(await audience.GET(makeReq("/api/email-campaigns/audience?region=8&cnae=4711302&cnaeScope=any")));
    assert.equal(v.total,2); assert.equal(v.eligible,1); assert.equal(v.invalidEmail,1);
    const main=await response(await audience.GET(makeReq("/api/email-campaigns/audience?region=8&cnae=4711302&cnaeScope=principal")));
    assert.equal(main.total,1); assert.equal(main.eligible,1);
  });
  await step("Destinatários preparados igualam prévia; nenhum envio", async () => {
    const [tpl] = await db.insert(emailTemplates).values({ ownerId:"local-preview-user",name:"Só teste",subject:"Teste",body:"Não enviar",createdAt:stamp,updatedAt:stamp }).returning();
    const campaign=await response(await campaigns.POST(makeReq("/api/email-campaigns","POST",{name:"Teste CNAE",templateId:tpl.id,audience:{region:8,cnae:"4711302",cnaeScope:"any"},batchSize:25,intervalMinutes:10})),201);
    const v=await response(await prepare.POST(makeReq("/api/email-campaigns/"+campaign.id+"/prepare","POST"),{params:Promise.resolve({id:String(campaign.id)})}));
    assert.equal(v.total,2); assert.equal(v.eligible,1); assert.equal(v.invalidEmail,1);
    const recipients=await db.select().from(emailCampaignRecipients).where(eq(emailCampaignRecipients.campaignId,campaign.id));
    assert.equal(recipients.length,1); assert.equal(recipients[0].recipient,"a@example.test");
    const [stored]=await db.select().from(emailCampaigns).where(eq(emailCampaigns.id,campaign.id));
    assert.equal(stored.batchSize,25); assert.equal(stored.intervalMinutes,10); assert.equal(stored.status,"READY");
  });
  console.log("CNAE END-TO-END: " + passed + " etapas aprovadas. Nenhum e-mail enviado.");
} finally {
  await client.end({ timeout:2 });
}
