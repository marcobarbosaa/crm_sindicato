import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loader } from './smart-test-loader.mjs';
const load = loader();
const { importSnapshot, smartJson, processImportQueue } = load('lib/smart-import-client.ts');
const { smartNumericId } = load('lib/smart-send-contract.ts');
const originalFetch = globalThis.fetch, originalWarn = console.warn;
let logs;
beforeEach(() => { logs = []; console.warn = (...args) => logs.push(args); });
afterEach(() => { globalThis.fetch = originalFetch; console.warn = originalWarn; });
const item = () => ({ documentId: crypto.randomUUID(), contentHash: 'a'.repeat(64), persistence: 'persisted', storage: 'stored', analysis: 'complete', code: null, message: 'PDF salvo.', recoverable: false });
test('ID do detalhe recebido como string aceita snapshot numérico de lote vazio', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ batchId: 1, items: [] });
    assert.deepEqual(await importSnapshot('1'), []);
  } finally { globalThis.fetch = original; }
});
for (const count of [0, 1, 30, 100]) test(`snapshot de ${count} documentos aceita apenas representações válidas do mesmo ID`, async () => {
  const items = Array.from({ length: count }, item);
  for (const requested of [1, '1', '001']) for (const returned of [1, '1', '001']) {
    globalThis.fetch = async url => { assert.equal(url, '/api/smart-sends/1/import-status'); return Response.json({ batchId: returned, items }); };
    assert.deepEqual(await importSnapshot(requested), items);
  }
});
test('IDs inválidos nunca são enviados nem aceitos na resposta', async () => {
  const invalid = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '', ' ', ' 1 ', '1.0', '1e2', '0x1', '+1', '-1', '0', '9007199254740993', true, false, null, undefined, {}, ['1']];
  for (const id of invalid) {
    assert.equal(smartNumericId.safeParse(id).success, false);
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ batchId: 1, items: [] }); };
    await assert.rejects(importSnapshot(id)); assert.equal(calls, 0);
    globalThis.fetch = async () => Response.json({ batchId: id, items: [] });
    await assert.rejects(importSnapshot(1));
  }
  assert.equal(smartNumericId.parse(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  globalThis.fetch = async () => Response.json({ batchId: 2, items: [] });
  await assert.rejects(importSnapshot('1'), /batchId/);
});
test('tipos de cada campo do item continuam estritos e o diagnóstico não inclui valores', async () => {
  const secret = 'PDF_TOKEN_RECIPIENT_SECRET';
  for (const [field, value] of Object.entries({ documentId: secret, contentHash: secret, persistence: secret, storage: secret, analysis: secret, code: 42, message: null, recoverable: 'false' })) {
    globalThis.fetch = async () => Response.json({ batchId: 1, items: [{ ...item(), [field]: value }] });
    await assert.rejects(importSnapshot('1'), error => error.code === 'INVALID_RESPONSE' && error.message.includes(`items.[].${field}`));
  }
  for (const body of [null, [], {}, { batchId: 1 }, { batchId: 1, items: {} }, { batchId: 1, items: [null] }]) {
    globalThis.fetch = async () => Response.json(body); await assert.rejects(importSnapshot(1));
  }
  globalThis.fetch = async () => Response.json({ batchId: 1, items: [{ ...item(), storage: 'pending' }] });
  await assert.rejects(importSnapshot(1));
  const text = JSON.stringify(logs); assert.equal(text.includes(secret), false); assert.equal(text.includes('received'), false); assert.match(text, /import-status/); assert.match(text, /recoverable/);
});
test('fronteira frontend normaliza IDs explícitos sem converter UUID, boolean ou conteúdo', async () => {
  const doc = item();
  globalThis.fetch = async () => Response.json({ batch: { id: '1', templateId: '2', accountId: '3' }, items: [{ id: doc.documentId, batchId: '1', companyId: '129', candidates: ['129'], suggestions: [{ id: '129', name: 'Empresa', primaryEmail: 'test@example.test' }], readable: true, body: '001' }] });
  const detail = await smartJson('/1');
  assert.equal(detail.batch.id, 1); assert.equal(detail.items[0].companyId, 129); assert.deepEqual(detail.items[0].candidates, [129]); assert.equal(detail.items[0].suggestions[0].id, 129);
  assert.equal(detail.items[0].id, doc.documentId); assert.equal(detail.items[0].body, '001'); assert.equal(detail.items[0].readable, true);
  for (const path of ['', '/companies?search=test', '/templates']) {
    globalThis.fetch = async () => Response.json([{ id: '129' }]); assert.equal((await smartJson(path))[0].id, 129);
  }
  globalThis.fetch = async () => Response.json({ id: '129' }); assert.equal((await smartJson('', { name: 'Lote' })).id, 129);
});
test('recuperação com ID string reconcilia documento salvo e prossegue sem reenvio', async () => {
  const saved = item(), pending = { ...item(), contentHash: 'b'.repeat(64) }; let sends = 0;
  globalThis.fetch = async () => Response.json({ batchId: 1, items: [saved] });
  const entries = [saved, pending].map(r => ({ id: r.documentId, hash: r.contentHash, name: 'doc.pdf', size: 100, progress: 0, phase: 'uncertain', state: 'Pendente' }));
  const outcome = await processImportQueue(entries, { snapshot: () => importSnapshot('1'), hasFile: () => true, changed: () => {}, sync: async () => {}, send: async () => { sends++; return pending; } }, true);
  assert.equal(sends, 1); assert.equal(outcome.warning, ''); assert.equal(outcome.entries.every(e => e.phase === 'confirmed'), true);
});
test('JSON real do serviço normaliza ID string e preserva os tipos dos itens', async () => {
  const doc = item();
  const row = { id: doc.documentId, contentHash: doc.contentHash, fileReady: true, fileDeletedAt: null, removedAt: null, duplicateOf: null, reviewStatus: 'IDENTIFIED', error: null, candidates: [], excluded: false };
  let results = [];
  const db = { select() { const rows = results.shift(); const chain = { from: () => chain, where: () => chain, orderBy: () => chain, then: (yes, no) => Promise.resolve(rows).then(yes, no) }; return chain; } };
  const service = loader({ '@/db': { getDb: () => db }, 'cloudflare:workers': { env: {} }, unpdf: {} })('lib/smart-send-service.ts');
  for (const count of [0, 1, 30, 100]) {
    results = [[{ id: '1' }], Array.from({ length: count }, () => row)];
    const body = JSON.parse(JSON.stringify(await service.getSmartImportStatus('synthetic', 1)));
    assert.equal(body.batchId, 1); assert.equal(body.items.length, count);
    for (const r of body.items) for (const [field, expected] of Object.entries({ documentId: 'string', contentHash: 'string', persistence: 'string', storage: 'string', analysis: 'string', message: 'string', recoverable: 'boolean' })) assert.equal(typeof r[field], expected);
    globalThis.fetch = async () => Response.json(body); assert.equal((await importSnapshot('1')).length, count);
  }
  results = [[{ id: '1' }], [], [], []];
  assert.equal((await service.getSmartBatch('synthetic', 1)).batch.id, 1);
});
