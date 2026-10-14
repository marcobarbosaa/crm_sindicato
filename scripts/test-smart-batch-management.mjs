import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as unpdf from 'unpdf';
import { loader, pdfFixture } from './smart-test-loader.mjs';
const engine = new PGlite(), schema = loader()('db/schema.ts'), db = drizzle(engine, { schema });
const realFetch = globalThis.fetch;
let options, objects, sends, encoded;
const config = key => ({ SMART_SEND_ALLOW_LOCAL: 'true' })[key];
const storage = { async put(key, bytes) { if (options.uploadFail) throw Error('storage'); await options.holdUpload?.(); objects.set(key, new Uint8Array(bytes)); if (options.lostStorageResponse) throw Error('timeout after save'); }, async get(key) { if (options.storageFail) throw Error('storage'); if (!objects.has(key)) throw new (load('lib/smart-send-policy.ts').SmartSendError)('missing', 404); return objects.get(key); }, async remove(key) { if (options.deleteFail) throw Error('storage unavailable'); objects.delete(key); if (options.deleteTimeout) throw new DOMException('timeout after removal', 'TimeoutError'); } };
storage.removeMany = async keys => {
  (options.deleteGroups ||= []).push([...keys]);
  await options.holdDelete?.();
  const confirmed = keys.slice(0, options.deletePartial ?? keys.length);
  for (const key of confirmed) await storage.remove(key);
  await options.afterDelete?.();
  return confirmed;
};
const actualGmail = loader()('lib/gmail.ts');
const storageModule = loader({ 'cloudflare:workers': { env: {} } })('lib/smart-send-storage.ts');
const gmailMock = { ...actualGmail, decryptToken: async () => 'synthetic', refreshAccessToken: async () => { if (options.oauthFail) throw new actualGmail.GmailOAuthError(400, 'invalid_grant'); await options.beforeBarrier?.(); return 'mock-token'; }, encodeRawEmail: args => { encoded.push(args); return actualGmail.encodeRawEmail(args); } };
const load = loader({ '@/db': { getDb: () => db, withCampaignDb: fn => fn() }, '@/db/schema': schema, unpdf,
  './attachment-storage': { storageConfig: config, attachmentStorage: () => ({ ...storage, get: async key => objects.get(key) }) },
  '@/lib/attachment-storage': { storageConfig: config },
  './smart-send-storage': { ...storageModule, smartStorage: () => storage, smartDeletionLimit: () => options.deleteLimit || 5 },
  './gmail': gmailMock, '@/lib/gmail': gmailMock,
  './gmail-delivery-client': { DeliverySyncError: class extends Error { constructor(code) { super(code); this.code = code; } },
    listDeliveryCandidates: async () => ({ ids: options.bounce ? ['bounce-1'] : [], nextPageToken: null }),
    readDeliveryCandidate: async () => options.bounce },
  'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
  '@/lib/smart-send-auth': { smartOwner: async () => 'local-preview-user' },
});
const service = load('lib/smart-send-service.ts');
const { documentSendBatches: batches, documentSendItems: items, emailMessages, companies, emailAccounts, emailTemplates, crmSettings } = schema;
let batchId, companyId, templateId;
before(async () => {
  await engine.exec('create role anon; create role authenticated;');
  await engine.exec(readFileSync('supabase/schema.sql', 'utf8').replace(/\uFEFF/g, ''));
  for (const file of readdirSync('supabase/migrations').sort()) await engine.exec(readFileSync('supabase/migrations/' + file, 'utf8').replace(/\uFEFF/g, ''));
});
beforeEach(async () => {
  options = {}; objects = new Map(); sends = []; encoded = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', 'Only mocked Gmail is allowed');
    sends.push(JSON.parse(init.body)); await options.onSend?.();
    if (options.timeout) throw new DOMException('timeout', 'TimeoutError');
    return Response.json(options.status ? { error: {} } : { id: `mock-${sends.length}` }, { status: options.status || 200 });
  };
  await engine.exec('truncate document_send_delivery_events, document_send_items, document_send_batches, email_messages, companies, email_templates, email_accounts, crm_settings, campaign_owner_leases restart identity cascade');
  const now = new Date(), ownerId = 'local-preview-user';
  [companyId] = (await db.insert(companies).values({ ownerId, name: 'Empresa Alfa', cnpj: '11222333000181', primaryEmail: 'alfa@example.test', createdAt: now, updatedAt: now }).returning()).map(r => Number(r.id));
  [templateId] = (await db.insert(emailTemplates).values({ ownerId, name: 'Documentos', subject: 'Documento para {{empresa}}', body: 'Olá {{contato}}, {{cidade}} {{segmento}}.', createdAt: now, updatedAt: now }).returning()).map(r => Number(r.id));
  await db.insert(emailAccounts).values({ ownerId, email: 'sender@example.test', encryptedRefreshToken: 'synthetic', scopes: actualGmail.GMAIL_SEND_SCOPE, connectedAt: now, updatedAt: now });
  await db.insert(crmSettings).values({ ownerId, signature: 'Assinatura CRM', dailySendLimit: 100, updatedAt: now });
  [batchId] = (await db.insert(batches).values({ ownerId, name: 'Lote sintético', createdAt: now, updatedAt: now }).returning()).map(r => Number(r.id));
});
after(async () => { globalThis.fetch = realFetch; await engine.close(); });
const owner = 'local-preview-user';
async function upload(text = 'Destinataria 11222333000181', name = 'alfa.pdf') {
  await service.uploadSmartPdf(owner, batchId, name, 'application/pdf', pdfFixture(text));
  return (await db.select().from(items)).at(-1);
}
async function prepared(count = 1) {
  for (let n = 0; n < count; n++) { const item = await upload(`Destinataria 11222333000181 documento ${n}`, `alfa-${n}.pdf`); await service.reviewSmartItem(owner, batchId, item.id, { companyId, confirm: true }); }
  await service.prepareSmartBatch(owner, batchId, templateId, false);
  return (await service.getSmartBatch(owner, batchId)).batch;
}
async function start(count = 1) { const batch = await prepared(count); await service.controlSmartBatch(owner, batchId, 'start', batch.revision, true); }

const management = load('lib/smart-batch-management.ts');
async function preview(ids = [batchId]) { return management.previewBatchDeletion(owner, ids); }
async function request(ids = [batchId]) {
  const checks = await preview(ids);
  return management.requestBatchDeletion(owner, checks.filter(r => r.eligible).map(({ id, revision, documents }) => ({ id, revision, documents })));
}
async function finishDeletion() {
  for (let n = 0; n < 10; n++) {
    const result = await management.processBatchDeletion();
    if (!result || !result.pending) return;
  }
  throw Error('Deletion did not finish');
}
async function another(ownerId = owner) {
  const [row] = await db.insert(batches).values({ ownerId, name: 'Outro lote', createdAt: new Date(), updatedAt: new Date() }).returning();
  return Number(row.id);
}
test('empty batch is removed from listing and keeps only an idempotent receipt', async () => {
  assert.equal((await request())[0].state, 'pending'); await finishDeletion();
  assert.equal((await management.batchDeletionStatus(owner, batchId)).state, 'deleted');
  assert.equal((await management.listSmartBatches(owner, { search: '', status: '', oldest: false, page: 0 })).rows.length, 0);
  assert.equal((await preview())[0].state, 'deleted');
  await assert.rejects(service.getSmartBatch(owner, batchId), /exclu/);
});
test('configured one-file chunk preserves metadata until every object is confirmed', async () => {
  options.deleteLimit = 1;
  await upload('one'); await upload('two'); const keys = [...objects.keys()];
  await request(); const result = await management.processBatchDeletion();
  assert.equal(result.deleted, 1); assert.equal(objects.size, 1);
  assert.equal((await db.select().from(items)).length, 2);
  await finishDeletion(); assert.equal(objects.size, 0); assert.equal(keys.length, 2);
  assert.equal((await db.select().from(items)).length, 0);
});

for (const count of [5, 20]) test(`${count} PDFs use groups of five, finalizing in the last invocation`, async () => {
  for (let i = 0; i < count; i++) await upload(`unique ${i}`);
  const foreignBatch = await another('other-owner');
  await service.uploadSmartPdf('other-owner', foreignBatch, 'foreign.pdf', 'application/pdf', pdfFixture('foreign'));
  const foreignKey = [...objects.keys()].at(-1);
  await request();
  assert.equal((await management.listSmartBatches(owner, {search:'',status:'',oldest:false,page:0})).rows.some(r=>r.id===batchId),false);
  assert.equal((await management.listSmartBatches(owner, {search:'',status:'DELETING',oldest:false,page:0})).rows[0].pendingFiles,count);
  for (let n=0;n<count/5;n++) {
    const result=await management.processBatchDeletion();
    assert.equal(result.deleted,5); assert.equal(result.pending,n<count/5-1);
    assert.equal((await management.batchDeletionStatus(owner,batchId)).pendingFiles,count-(n+1)*5);
  }
  assert.equal(options.deleteGroups.length,count/5); assert.ok(options.deleteGroups.every(keys=>keys.length===5 && !keys.includes(foreignKey)));
  assert.equal(objects.size,1); assert.ok(objects.has(foreignKey));
  assert.equal((await management.batchDeletionStatus(owner,batchId)).state,'deleted');
  assert.equal((await service.getSmartBatch('other-owner',foreignBatch)).items.length,1);
});

test('partial removal commits only confirmed keys and retries remaining objects', async () => {
  for(let i=0;i<5;i++) await upload(`partial ${i}`);
  await request(); options.deletePartial=2;
  const result=await management.processBatchDeletion(); assert.equal(result.deleted,2); assert.equal(result.pending,true);
  const rows=await db.select().from(items); assert.equal(rows.filter(r=>r.fileDeletedAt).length,2); assert.equal(objects.size,3);
  assert.ok((await management.batchDeletionStatus(owner,batchId)).error);
  options.deletePartial=undefined; await finishDeletion(); assert.equal(objects.size,0);
  assert.equal(options.deleteGroups[1].length,3);
});

test('Storage wait holds no SQL transaction: create, read, upload, repeated request and another cleanup proceed', async () => {
  await upload('delete'); const choices=await preview(); await management.requestBatchDeletion(owner,choices);
  let release, entered;
  const started=new Promise(resolve=>{entered=resolve;});
  options.holdDelete=()=>{entered();return new Promise(resolve=>{release=resolve;});};
  const cleaning=management.processBatchDeletion(); await started;
  try {
    await Promise.race([(async()=>{
      const route=load('app/api/smart-sends/[[...path]]/route.ts');
      const created=await route.POST(new Request('https://app.test/api/smart-sends',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Novo durante limpeza'})}),{params:Promise.resolve({path:[]})});
      assert.equal(created.status,201); const {id}=await created.json();
      assert.equal((await service.getSmartBatch(owner,id)).items.length,0);
      assert.equal((await management.requestBatchDeletion(owner,choices))[0].state,'pending');
      assert.equal(await management.processBatchDeletion(),null,'active lease is skipped');
      await service.uploadSmartPdf(owner,id,'new.pdf','application/pdf',pdfFixture('new during deletion'));
      assert.equal((await service.getSmartBatch(owner,id)).items.length,1);
    })(),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('operations waited for Storage')),2000);timer.unref();})]);
  } finally { release(); await cleaning; }
  assert.equal(objects.size,1); assert.equal(options.deleteGroups.length,1);
});

test('interrupted finalization leaves a durable lease and safely recovers absent objects', async () => {
  await upload(); await request();
  const transaction=db.transaction.bind(db); let interrupted=false;
  options.afterDelete=()=>{interrupted=true;};
  db.transaction=(...args)=>interrupted ? Promise.reject(Error('worker interrupted before commit')) : transaction(...args);
  try { await assert.rejects(management.processBatchDeletion(),/interrupted/); }
  finally { db.transaction=transaction; options.afterDelete=undefined; }
  const [batch]=await db.select().from(batches).where(eq(batches.id,batchId));
  assert.ok(batch.lockToken.startsWith('delete:')); assert.ok(batch.lockUntil); assert.equal(objects.size,0);
  assert.equal((await db.select().from(items))[0].fileDeletedAt,null);
  assert.equal(await management.processBatchDeletion(),null);
  await db.update(batches).set({lockUntil:new Date(0)}).where(eq(batches.id,batchId));
  await finishDeletion(); assert.equal((await management.batchDeletionStatus(owner,batchId)).state,'deleted');
});

test('a late cleanup cannot finalize or clear a newer lease', async () => {
  await upload(); await request();
  let release, entered;
  const started=new Promise(resolve=>{entered=resolve;});
  options.holdDelete=()=>{entered();return new Promise(resolve=>{release=resolve;});};
  const old=management.processBatchDeletion(); await started;
  await db.update(batches).set({lockUntil:new Date(0)}).where(eq(batches.id,batchId));
  options.holdDelete=undefined;
  const newer=await management.processBatchDeletion(); assert.equal(newer.pending,false);
  release(); assert.equal((await old).deleted,0);
  assert.equal((await management.batchDeletionStatus(owner,batchId)).state,'deleted');
});

test('mismatched storage key or owner is never sent to Storage', async () => {
  const row=await upload(); await request();
  await db.update(items).set({storageKey:`smart-sends/${crypto.randomUUID()}.pdf`}).where(eq(items.id,row.id));
  assert.equal((await management.processBatchDeletion()).deleted,0); assert.equal(options.deleteGroups,undefined);
  await assert.rejects(db.update(items).set({storageKey:row.storageKey,ownerId:'other-owner'}).where(eq(items.id,row.id)),e=>e.cause?.code==='23503');
  assert.equal((await management.processBatchDeletion()).deleted,0); assert.equal(objects.size,1);
});

test('deletion opportunities use scheduled event time and preserve retention slots', async () => {
  await upload(); await request();
  await service.cleanupSmartFiles(8*60_000); assert.equal(options.deleteGroups,undefined);
  await service.cleanupSmartFiles(0); assert.equal(options.deleteGroups.length,1);
});
test('prepared and reviewed batch never started is eligible', async () => {
  await prepared(); assert.equal((await preview())[0].eligible, true);
  await request(); await finishDeletion(); assert.equal(sends.length, 0);
});
for (const status of ['RUNNING', 'PAUSED', 'CANCELLED', 'COMPLETED']) test(`${status} is conservatively blocked`, async () => {
  await db.update(batches).set({ status }).where(eq(batches.id, batchId));
  assert.equal((await preview())[0].eligible, false);
});
test('started, cancelled or reset batches retain persistent send evidence', async () => {
  await start(); await service.controlSmartBatch(owner, batchId, 'cancel');
  assert.equal((await preview())[0].eligible, false);
  await db.update(batches).set({ status: 'DRAFT' }).where(eq(batches.id, batchId));
  assert.equal((await preview())[0].eligible, false);
});
for (const sendStatus of ['SENT', 'UNCERTAIN', 'PROCESSING', 'FAILED', 'PENDING', 'SKIPPED']) test(`item ${sendStatus} blocks a misleading draft batch`, async () => {
  const row = await upload(); await db.update(items).set({ sendStatus }).where(eq(items.id, row.id));
  assert.equal((await preview())[0].eligible, false);
});
test('detached email RFC/attachment reference and audit block deletion; no historical data is removed', async () => {
  const row = await upload();
  const [message] = await db.insert(emailMessages).values({ ownerId: owner, recipient: 'synthetic@example.test', subject: 'Test', body: 'Test', kind: 'SMART', status: 'RETRYABLE', rfcMessageId: row.rfcMessageId, createdAt: new Date() }).returning();
  assert.equal((await preview())[0].eligible, false);
  await db.update(emailMessages).set({ rfcMessageId: null, attachments: [{ id: row.id }] }).where(eq(emailMessages.id, message.id));
  assert.equal((await preview())[0].eligible, false);
  assert.equal((await db.select().from(emailMessages)).length, 1);
});
test('delivery event and activity log each block deletion', async () => {
  const row = await upload();
  await db.insert(schema.documentSendDeliveryEvents).values({ itemId: row.id, ownerId: owner, gmailMessageId: 'fake', status: 'BOUNCED', category: 'TEST', createdAt: new Date() });
  assert.equal((await preview())[0].eligible, false);
  await db.delete(schema.documentSendDeliveryEvents);
  await db.insert(schema.activityLogs).values({ ownerId: owner, type: 'EMAIL_SENT', description: `Envio Inteligente #${batchId} aceito pelo Gmail: synthetic.pdf`, createdAt: new Date() });
  assert.equal((await preview())[0].eligible, false);
  await db.delete(schema.activityLogs);
});
test('multiple eligible drafts plus blocked batch: only explicitly confirmed eligible IDs are requested', async () => {
  const second = await another(), third = await another();
  await db.update(batches).set({ status: 'RUNNING' }).where(eq(batches.id, third));
  const checks = await preview([batchId, second, third]); assert.equal(checks.filter(r => r.eligible).length, 2);
  const results = await management.requestBatchDeletion(owner, checks.map(({ id, revision, documents }) => ({ id, revision, documents })));
  assert.equal(results.filter(r => r.state === 'pending').length, 2); assert.equal(results.at(-1).state, 'blocked');
  await finishDeletion(); await finishDeletion();
  assert.equal((await service.getSmartBatch(owner, third)).batch.status, 'RUNNING');
});
test('confirmation is rejected if upload changed the reviewed snapshot', async () => {
  const [check] = await preview(); await upload();
  const [result] = await management.requestBatchDeletion(owner, [check]); assert.equal(result.state, 'blocked');
  assert.match(result.reason, /mudou/); assert.equal(objects.size, 1);
});
test('storage failure retains metadata and resumes after worker restart', async () => {
  await upload(); await request(); options.deleteFail = true;
  assert.equal((await management.processBatchDeletion()).deleted, 0);
  assert.equal((await management.batchDeletionStatus(owner, batchId)).state, 'pending');
  assert.ok((await management.batchDeletionStatus(owner, batchId)).error);
  assert.equal(objects.size, 1); assert.equal((await db.select().from(items)).length, 1);
  options.deleteFail = false; await finishDeletion(); assert.equal(objects.size, 0);
});
test('timeout after storage accepted DELETE is safely retried', async () => {
  await upload(); await request(); options.deleteTimeout = true;
  await management.processBatchDeletion(); assert.equal(objects.size, 0);
  assert.equal((await db.select().from(items))[0].fileDeletedAt, null);
  options.deleteTimeout = false; await finishDeletion();
  assert.equal((await management.batchDeletionStatus(owner, batchId)).state, 'deleted');
});
test('lost upload acknowledgement still cleans possibly stored object', async () => {
  options.lostStorageResponse = true; const row = await upload();
  assert.equal(row.fileReady, false); assert.equal(objects.size, 1);
  await request(); await finishDeletion(); assert.equal(objects.size, 0);
});
test('concurrent deletion requests and cleanup executions are idempotent', async () => {
  await upload(); const choices = await preview();
  const results = await Promise.all([management.requestBatchDeletion(owner, choices), management.requestBatchDeletion(owner, choices)]);
  assert.ok(results.every(r => r[0].state === 'pending'));
  await Promise.all([management.processBatchDeletion(), management.processBatchDeletion()]);
  await finishDeletion(); assert.equal(objects.size, 0);
});
test('other owner cannot preview, request, or read deletion result', async () => {
  const id = await another('other-owner');
  assert.equal((await preview([id]))[0].name, 'Lote indisponível');
  const [result] = await management.requestBatchDeletion(owner, [{ id, revision: 0, documents: 0 }]);
  assert.equal(result.state, 'blocked');
  await assert.rejects(management.batchDeletionStatus(owner, id), /não encontrado/);
  assert.equal((await service.getSmartBatch('other-owner', id)).batch.status, 'DRAFT');
});
test('internal duplicate FK permits removal; external duplicate blocks original', async () => {
  await upload(); await upload();
  assert.equal((await preview())[0].eligible, true);
  const other = await another();
  await service.uploadSmartPdf(owner, other, 'copy.pdf', 'application/pdf', pdfFixture('Destinataria 11222333000181'));
  assert.equal((await preview())[0].eligible, false);
  await request([other]); await finishDeletion();
  assert.equal(objects.size, 1); // duplicate owns no object; original survived
  await request(); await finishDeletion(); assert.equal(objects.size, 0);
});
test('active upload/recovery blocks even if its visible review state is overwritten', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  options.holdUpload = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const pending = upload(); await started;
  assert.equal((await preview())[0].eligible, false);
  const [row] = await db.select().from(items);
  await assert.rejects(service.reviewSmartItem(owner, batchId, row.id, { remove: true }), /importação/);
  await db.update(items).set({ reviewStatus: 'READ_ERROR' }).where(eq(items.id, row.id));
  assert.equal((await preview())[0].eligible, false);
  release(); await pending;
});
test('expired UPLOADING remains blocked, pending deletion refuses stale browser queue', async () => {
  const row = await upload();
  await db.update(items).set({ reviewStatus: 'UPLOADING', updatedAt: new Date(0) }).where(eq(items.id, row.id));
  assert.equal((await preview())[0].eligible, false);
  await db.update(items).set({ reviewStatus: 'IDENTIFIED' }).where(eq(items.id, row.id));
  await request();
  await assert.rejects(service.uploadSmartPdf(owner, batchId, 'stale.pdf', 'application/pdf', pdfFixture('stale')), /exclu/);
  await assert.rejects(service.getSmartImportStatus(owner, batchId), /exclu/);
  await assert.rejects(service.controlSmartBatch(owner, batchId, 'start', 0, true), /exclu/);
});
test('list paginates and filters across more than 100 batches and preserves traditional history', async () => {
  for (let i = 0; i < 105; i++) await another();
  const input = { search: 'Outro lote', status: 'DRAFT', oldest: true, page: 0 };
  const first = await management.listSmartBatches(owner, input); assert.equal(first.rows.length, 20); assert.equal(first.hasMore, true);
  const last = await management.listSmartBatches(owner, { ...input, page: 5 }); assert.equal(last.rows.length, 5); assert.equal(last.hasMore, false);
  await db.insert(emailMessages).values({ ownerId: owner, recipient: 'synthetic@example.test', subject: 'Traditional', body: 'Test', kind: 'BATCH', status: 'SENT', createdAt: new Date() });
  await request(); await finishDeletion(); assert.equal((await db.select().from(emailMessages))[0].kind, 'BATCH');
});
test('deletion API requires explicit confirmation and strict IDs; status survives reload', async () => {
  const route = load('app/api/smart-sends/[[...path]]/route.ts');
  const post = async (path, body) => route.POST(new Request(`https://app.test/api/smart-sends/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ path: [path] }) });
  assert.equal((await post('deletion-preview', { ids: [String(batchId)] })).status, 400);
  assert.equal((await post('deletion-preview', { ids: [1, 2, 3, 4, 5, 6] })).status, 400);
  const [check] = await (await post('deletion-preview', { ids: [batchId] })).json();
  const choices = [{ id: check.id, revision: check.revision, documents: check.documents }];
  assert.equal((await post('deletion-request', { batches: choices })).status, 400);
  assert.equal((await post('deletion-request', { batches: choices, confirmed: true })).status, 202);
  await finishDeletion();
  const response = await route.GET(new Request('https://app.test/api/smart-sends/1/deletion'), { params: Promise.resolve({ path: [String(batchId), 'deletion'] }) });
  assert.equal((await response.json()).state, 'deleted');
});
test('local queue cleanup is scoped to confirmed batch only; stale queue cannot send after reload', async () => {
  const client = load('lib/smart-import-client.ts');
  const data = new Map([['smart-import:v1:1', '[]'], ['smart-import:v1:2', '[]'], ['unrelated', 'keep']]);
  client.clearImportQueue({ removeItem: key => data.delete(key) }, 1);
  assert.equal(data.has('smart-import:v1:1'), false); assert.equal(data.has('smart-import:v1:2'), true); assert.equal(data.get('unrelated'), 'keep');
  let sent = false;
  await client.processImportQueue([{ id: crypto.randomUUID(), hash: 'a'.repeat(64), phase: 'queued' }], {
    snapshot: async () => { throw Error('Lote excluído'); }, send: async () => { sent = true; }, hasFile: () => true, changed: () => {}, sync: async () => {},
  });
  assert.equal(sent, false);
});
