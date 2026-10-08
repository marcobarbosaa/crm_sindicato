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
const storage = { async put(key, bytes) { if (options.uploadFail) throw Error('storage'); objects.set(key, new Uint8Array(bytes)); }, async get(key) { if (options.storageFail) throw Error('storage'); return objects.get(key); }, async remove(key) { objects.delete(key); } };
const actualGmail = loader()('lib/gmail.ts');
const storageModule = loader({ 'cloudflare:workers': { env: {} } })('lib/smart-send-storage.ts');
const gmailMock = { ...actualGmail, decryptToken: async () => 'synthetic', refreshAccessToken: async () => { if (options.oauthFail) throw new actualGmail.GmailOAuthError(400, 'invalid_grant'); await options.beforeBarrier?.(); return 'mock-token'; }, encodeRawEmail: args => { encoded.push(args); return actualGmail.encodeRawEmail(args); } };
const load = loader({ '@/db': { getDb: () => db, withCampaignDb: fn => fn() }, '@/db/schema': schema, unpdf,
  './attachment-storage': { storageConfig: config, attachmentStorage: () => ({ ...storage, get: async key => objects.get(key) }) },
  './smart-send-storage': { ...storageModule, smartStorage: () => storage },
  './gmail': gmailMock, '@/lib/gmail': gmailMock,
  './gmail-delivery-client': { DeliverySyncError: class extends Error { constructor(code) { super(code); this.code = code; } },
    listDeliveryCandidates: async () => ({ ids: options.bounce ? ['bounce-1'] : [], nextPageToken: null }),
    readDeliveryCandidate: async () => options.bounce },
  'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
  '@/lib/smart-send-auth': { smartOwner: async () => 'local-preview-user' },
});
const service = load('lib/smart-send-service.ts'), runner = load('lib/smart-send-runner.ts'), shared = load('lib/shared-send-control.ts');
const delivery = load('lib/smart-send-delivery.ts'), attachmentService = load('lib/attachment-service.ts');
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
async function due() { await db.update(batches).set({ nextRunAt: new Date(0) }).where(eq(batches.id, batchId)); }
test('migração, upload, confirmação e associação garantem somente o PDF aprovado e assinatura', async () => {
  await start(); assert.equal(sends.length, 0);
  await runner.processSmartBatch(owner, batchId);
  assert.equal(sends.length, 1); assert.equal(encoded[0].to, 'alfa@example.test'); assert.equal(encoded[0].attachments.length, 1);
  assert.match(encoded[0].body, /Assinatura CRM/); assert.match(encoded[0].subject, /Empresa Alfa/);
  assert.equal((await db.select().from(items))[0].sendStatus, 'SENT');
  assert.equal((await db.select().from(emailMessages))[0].kind, 'SMART');
});
test('dois documentos da mesma empresa geram envios distintos, cada um com somente seu PDF', async () => {
  await start(2); await runner.processSmartBatch(owner, batchId); await due(); await runner.processSmartBatch(owner, batchId);
  assert.equal(sends.length, 2); assert.notEqual(encoded[0].attachments[0].name, encoded[1].attachments[0].name);
  assert.equal(encoded.every(e => e.attachments.length === 1), true);
});
test('duplicata por hash bloqueada e nunca confirmável', async () => {
  await upload(); const duplicate = await upload(); assert.equal(duplicate.reviewStatus, 'DUPLICATE');
  await assert.rejects(service.reviewSmartItem(owner, batchId, duplicate.id, { companyId, confirm: true }));
});
test('arquivo, empresa, lote e preview de outro proprietário são inacessíveis', async () => {
  const item = await upload();
  await assert.rejects(service.reviewSmartItem('intruder', batchId, item.id, { companyId, confirm: true }), /não encontrado/);
  await assert.rejects(service.getSmartBatch('intruder', batchId), /não encontrado/);
  const [foreign] = await db.insert(companies).values({ ownerId: 'intruder', name: 'Outra', primaryEmail: 'other@example.test', createdAt: new Date(), updatedAt: new Date() }).returning();
  await assert.rejects(service.reviewSmartItem(owner, batchId, item.id, { companyId: Number(foreign.id), confirm: true }), /não encontrada/);
});
test('falha de upload permanece rastreável e bloqueada', async () => {
  options.uploadFail = true; await assert.rejects(upload()); const [item] = await db.select().from(items);
  assert.equal(item.fileReady, false); assert.equal(item.reviewStatus, 'READ_ERROR'); assert.equal(sends.length, 0);
});
test('falha de storage nunca inicia Gmail e tem retentativas limitadas', async () => {
  await start(); options.storageFail = true;
  for (let n = 0; n < 3; n++) { await due(); await runner.processSmartBatch(owner, batchId); }
  assert.equal(sends.length, 0); assert.equal((await db.select().from(items))[0].sendStatus, 'FAILED');
});
test('autenticação Gmail revogada pausa lote sem enviar', async () => {
  await start(); options.oauthFail = true; await runner.processSmartBatch(owner, batchId);
  assert.equal(sends.length, 0); assert.equal((await db.select().from(batches))[0].status, 'PAUSED'); assert.equal((await db.select().from(emailAccounts))[0].needsReconnect, true);
});
test('limite diário inclui reservas incertas de campanhas e envio individual', async () => {
  await start(); await db.update(crmSettings).set({ dailySendLimit: 1 });
  await db.insert(emailMessages).values({ ownerId: owner, recipient: 'other@example.test', subject: 'old', body: 'old', status: 'UNCERTAIN', createdAt: new Date() });
  assert.equal((await runner.processSmartBatch(owner, batchId)).dailyLimit, true); assert.equal(sends.length, 0);
});
test('timeout resulta em UNCERTAIN, nova execução e resume não reenviam', async () => {
  await start(); options.timeout = true; await runner.processSmartBatch(owner, batchId);
  assert.equal((await db.select().from(items))[0].sendStatus, 'UNCERTAIN'); assert.equal((await db.select().from(emailMessages))[0].status, 'UNCERTAIN');
  await due(); await runner.processSmartBatch(owner, batchId); await assert.rejects(service.controlSmartBatch(owner, batchId, 'resume')); assert.equal(sends.length, 1);
});
test('cancelamento antes da barreira bloqueia envio; após a barreira preserva aceitação', async () => {
  await start(); options.beforeBarrier = () => service.controlSmartBatch(owner, batchId, 'cancel'); await runner.processSmartBatch(owner, batchId); assert.equal(sends.length, 0);
});
test('cancelamento durante fetch preserva enviado e ignora restantes', async () => {
  await start(2); options.onSend = () => service.controlSmartBatch(owner, batchId, 'cancel'); await runner.processSmartBatch(owner, batchId);
  assert.deepEqual((await db.select().from(items)).map(i => i.sendStatus).sort(), ['SENT', 'SKIPPED']); assert.equal(sends.length, 1);
});
test('reinício com barreira persistida torna PROCESSING incerto', async () => {
  await start(); const [item] = await db.select().from(items);
  const [message] = await db.insert(emailMessages).values({ ownerId: owner, recipient: item.recipient, subject: 'synthetic', body: 'synthetic', status: 'SENDING', createdAt: new Date() }).returning();
  await db.update(items).set({ sendStatus: 'PROCESSING', processingAt: new Date(Date.now() - 11 * 60_000), messageId: Number(message.id) });
  await runner.processSmartBatch(owner, batchId); assert.equal((await db.select().from(items))[0].sendStatus, 'UNCERTAIN'); assert.equal(sends.length, 0);
});
test('execuções concorrentes e lease tradicional permitem um único envio', async () => {
  await start(); const lease = await shared.acquireSendLease(owner); assert.equal((await runner.processSmartBatch(owner, batchId)).locked, true);
  await shared.releaseSendLease(owner, lease.token); await Promise.all([runner.processSmartBatch(owner, batchId), runner.processSmartBatch(owner, batchId)]); assert.equal(sends.length, 1);
});
test('rejeições transitórias respeitam máximo de três tentativas', async () => {
  await start(); options.status = 429;
  for (let n = 0; n < 4; n++) { await due(); await runner.processSmartBatch(owner, batchId); }
  assert.equal(sends.length, 3); assert.equal((await db.select().from(items))[0].sendStatus, 'FAILED');
});
test('alteração na associação invalida prévia e impede confirmação desatualizada', async () => {
  const batch = await prepared(), [item] = await db.select().from(items);
  await service.reviewSmartItem(owner, batchId, item.id, { excluded: true });
  await assert.rejects(service.controlSmartBatch(owner, batchId, 'start', batch.revision, true)); assert.equal(sends.length, 0);
});
test('sem confirmação explícita nenhum e-mail sai; destinatário alterado bloqueia', async () => {
  const batch = await prepared(); await assert.rejects(service.controlSmartBatch(owner, batchId, 'start', batch.revision, false));
  await service.controlSmartBatch(owner, batchId, 'start', batch.revision, true);
  await db.update(companies).set({ primaryEmail: 'changed@example.test' }); await runner.processSmartBatch(owner, batchId);
  assert.equal(sends.length, 0); assert.equal((await db.select().from(items))[0].sendStatus, 'FAILED');
});
test('retenção preserva PDFs pendentes e remove rascunhos abandonados', async () => {
  await start(); await db.update(batches).set({ updatedAt: new Date(0) }); await service.cleanupSmartFiles(); assert.equal(objects.size, 1);
  await db.update(items).set({ sendStatus: 'DRAFT' }); await db.update(batches).set({ status: 'DRAFT' }); await service.cleanupSmartFiles();
  assert.equal(objects.size, 0); const [item] = await db.select().from(items); assert.ok(item.fileDeletedAt); assert.equal(item.fileName, 'alfa-0.pdf');
});
test('DSN correlaciona referência exata; SENT é preservado e endereço inválido é auditado', async () => {
  await start(); await runner.processSmartBatch(owner, batchId);
  const [item] = await db.select().from(items);
  await db.update(emailAccounts).set({ scopes: `${actualGmail.GMAIL_SEND_SCOPE} ${actualGmail.GMAIL_READ_SCOPE}` });
  const raw = `From: mailer-daemon@example.test\r\nIn-Reply-To: ${item.rfcMessageId}\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="dsn"\r\n\r\n--dsn\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; mail.example.test\r\n\r\nFinal-Recipient: rfc822; ${item.recipient}\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 user unknown\r\n\r\n--dsn--\r\n`;
  options.bounce = { id: 'bounce-1', receivedAt: Date.now(), raw };
  await db.update(items).set({ deliveryNextAt: new Date(0) }); await delivery.checkSmartDelivery();
  const [updated] = await db.select().from(items); assert.equal(updated.sendStatus, 'SENT'); assert.equal(updated.deliveryStatus, 'BOUNCED');
  assert.equal((await db.select().from(companies))[0].primaryEmailStatus, 'INVALID');
  await db.update(items).set({ deliveryNextAt: new Date(0) }); await delivery.checkSmartDelivery();
  assert.equal((await db.select().from(schema.documentSendDeliveryEvents)).length, 1);
});
test('aceitação não é entrega; sem readonly mantém monitoramento pendente', async () => {
  await start(); await runner.processSmartBatch(owner, batchId); await db.update(items).set({ deliveryNextAt: new Date(0) }); await delivery.checkSmartDelivery();
  const [item] = await db.select().from(items); assert.equal(item.deliveryStatus, 'PENDING'); assert.equal(item.deliveryError, 'GMAIL_READ_SCOPE_MISSING');
  await db.update(emailAccounts).set({ scopes: `${actualGmail.GMAIL_SEND_SCOPE} ${actualGmail.GMAIL_READ_SCOPE}` });
  await db.update(items).set({ deliveryNextAt: new Date(0) }); await delivery.checkSmartDelivery();
  assert.equal((await db.select().from(items))[0].deliveryStatus, 'NO_KNOWN_FAILURE');
});
test('anexos comuns são opt-in e permanecem retidos após edição do template', async () => {
  const item = await upload(); await service.reviewSmartItem(owner, batchId, item.id, { companyId, confirm: true });
  const id = crypto.randomUUID(), key = 'attachments/' + id;
  objects.set(key, new TextEncoder().encode('Comum'));
  await db.insert(schema.templateAttachments).values({ id, ownerId: owner, templateId, name: 'comum.txt', mimeType: 'text/plain', size: 5, storageKey: key, ready: true, expiresAt: new Date(0), createdAt: new Date() });
  await service.prepareSmartBatch(owner, batchId, templateId, false);
  assert.equal((await service.getSmartBatch(owner, batchId)).batch.commonAttachments.length, 0);
  await service.prepareSmartBatch(owner, batchId, templateId, true);
  await db.update(schema.templateAttachments).set({ templateId: null });
  assert.deepEqual(await attachmentService.cleanupAttachments(), { deleted: 0, pending: 0 }); assert.equal(objects.has(key), true);
  const batch = (await service.getSmartBatch(owner, batchId)).batch; await service.controlSmartBatch(owner, batchId, 'start', batch.revision, true);
  await runner.processSmartBatch(owner, batchId); assert.equal(encoded[0].attachments.length, 2);
});
test('empresas diferentes recebem somente o próprio documento', async () => {
  const [beta] = await db.insert(companies).values({ ownerId: owner, name: 'Beta', cnpj: '11444777000161', primaryEmail: 'beta@example.test', createdAt: new Date(), updatedAt: new Date() }).returning();
  const first = await upload('Destinataria 11222333000181', 'alfa.pdf'); await service.reviewSmartItem(owner, batchId, first.id, { companyId, confirm: true });
  const second = await upload('Destinataria 11444777000161', 'beta.pdf'); await service.reviewSmartItem(owner, batchId, second.id, { companyId: Number(beta.id), confirm: true });
  await service.prepareSmartBatch(owner, batchId, templateId, false); const batch = (await service.getSmartBatch(owner, batchId)).batch;
  await service.controlSmartBatch(owner, batchId, 'start', batch.revision, true); await runner.processSmartBatch(owner, batchId); await due(); await runner.processSmartBatch(owner, batchId);
  assert.deepEqual(encoded.map(e => [e.to, e.attachments.map(a => a.name)]), [['alfa@example.test', ['alfa.pdf']], ['beta@example.test', ['beta.pdf']]]);
});
test('envio individual participa do lease e sua mensagem consome cota da fila', async () => {
  await start(); const route = load('app/api/emails/route.ts');
  const request = () => new Request('https://app.test/api/emails', { method: 'POST', body: JSON.stringify({ companyId, recipient: 'alfa@example.test', subject: 'Individual', body: 'Olá' }) });
  const lease = await shared.acquireSendLease(owner); assert.equal((await route.POST(request())).status, 409); assert.equal(sends.length, 0);
  await shared.releaseSendLease(owner, lease.token); assert.equal((await route.POST(request())).status, 200);
  await db.update(crmSettings).set({ dailySendLimit: 1 }); assert.equal((await runner.processSmartBatch(owner, batchId)).dailyLimit, true); assert.equal(sends.length, 1);
});
test('rota legada compartilha lease/cota e timeout reserva resultado incerto', async () => {
  const route = load('app/api/email-batches/route.ts');
  const request = () => new Request('https://app.test/api/email-batches', { method: 'POST', body: JSON.stringify({ companyIds: [companyId], templateId, confirmed: true }) });
  const lease = await shared.acquireSendLease(owner); assert.equal((await route.POST(request())).status, 409);
  await shared.releaseSendLease(owner, lease.token); options.timeout = true;
  const response = await route.POST(request()); assert.equal(response.status, 200); assert.equal((await response.json()).uncertain, 1);
  assert.equal((await db.select().from(emailMessages))[0].status, 'UNCERTAIN');
});
