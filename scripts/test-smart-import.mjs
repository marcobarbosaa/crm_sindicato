import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loader, pdfFixture } from './smart-test-loader.mjs';
const { processImportQueue, ImportRequestError, decodeResponse, restoreImportQueue, saveImportQueue, identifyFile, uploadPdf } = loader()('lib/smart-import-client.ts');
const { SMART_DEFAULTS } = loader()('lib/smart-send-policy.ts');
const entry = n => ({ id: crypto.randomUUID(), hash: n.toString(16).padStart(64, '0'), name: `${n}.pdf`, size: 100, progress: 0, phase: 'queued', state: 'Aguardando' });
const result = e => ({ documentId: e.id, contentHash: e.hash, persistence: 'persisted', storage: 'stored', analysis: 'complete', code: null, message: 'PDF salvo e analisado.', recoverable: false });
function harness(count, options = {}) {
  const entries = Array.from({ length: count }, (_, n) => entry(n + 1));
  const saved = new Map(), sent = [], states = []; let snapshots = 0, syncs = 0;
  const io = {
    snapshot: async () => { snapshots++; if (options.snapshotFail) throw Error('database unavailable'); return [...saved.values()]; },
    hasFile: () => true,
    send: async (e, recover, progress) => { sent.push(e.name); progress(100); const response = result(e); if (options.send) return options.send(e, response, saved, recover); saved.set(e.id, response); return response; },
    changed: rows => states.push(structuredClone(rows)),
    sync: async () => { syncs++; if (options.syncFail) throw Error('visual refresh unavailable'); },
  };
  return { entries, saved, sent, io, states, metrics: () => ({ snapshots, syncs }) };
}
for (const count of [1, 10, 26, 30, 50, 100]) test(`${count} PDFs: todos verificáveis e uma única atualização completa`, async () => {
  const h = harness(count, { syncFail: true });
  const outcome = await processImportQueue(h.entries, h.io);
  assert.equal(h.sent.length, count); assert.equal(outcome.entries.every(e => e.phase === 'confirmed' && e.result.persistence === 'persisted'), true);
  assert.match(outcome.warning, /atualizar a tela/); assert.deepEqual(h.metrics(), { snapshots: 1, syncs: 1 });
});
test('26º rejeitado por 400/413 não interrompe arquivos posteriores', async () => {
  for (const status of [400, 413]) {
    const h = harness(30, { send: async (e, r, saved) => { if (e.name === '26.pdf') throw new ImportRequestError('Arquivo inválido', status); saved.set(e.id, r); return r; } });
    const outcome = await processImportQueue(h.entries, h.io);
    assert.equal(h.sent.length, 30); assert.equal(outcome.entries[25].phase, 'rejected'); assert.equal(outcome.entries[29].phase, 'confirmed');
  }
});
test('conexão interrompida após salvar reconcilia e continua', async () => {
  const h = harness(30, { send: async (e, r, saved) => { saved.set(e.id, r); if (e.name === '26.pdf') throw new ImportRequestError('connection'); return r; } });
  const outcome = await processImportQueue(h.entries, h.io);
  assert.equal(h.sent.length, 30); assert.equal(outcome.entries.every(e => e.phase === 'confirmed'), true);
});
for (const status of [0, 408, 500, 502, 503, 504]) test(`resultado incerto (${status}) preserva a fila e recupera com o mesmo ID`, async () => {
  let fail = true;
  const h = harness(30, { send: async (e, r, saved) => { if (e.name === '26.pdf' && fail) throw new ImportRequestError('uncertain', status); saved.set(e.id, r); return r; } });
  const outcome = await processImportQueue(h.entries, h.io);
  assert.equal(h.sent.length, 26); assert.equal(outcome.entries[25].phase, 'uncertain'); assert.equal(outcome.entries[26].phase, 'queued');
  fail = false;
  const resumed = await processImportQueue(outcome.entries, h.io, true);
  assert.equal(resumed.entries[25].id, h.entries[25].id); assert.equal(h.sent.length, 31); assert.equal(h.saved.size, 30);
});
for (const status of [401, 403, 429]) test(`falha global ${status} interrompe preservando a fila`, async () => {
  const h = harness(30, { send: async () => { throw new ImportRequestError('global', status); } });
  const outcome = await processImportQueue(h.entries, h.io); assert.equal(h.sent.length, 1); assert.equal(outcome.entries[1].phase, 'queued');
});
test('503 persistente mesmo com registros salvos pausa após duas falhas', async () => {
  const h = harness(30, { send: async (e, r, saved) => { saved.set(e.id, r); throw new ImportRequestError('Worker indisponível', 503); } });
  const outcome = await processImportQueue(h.entries, h.io); assert.equal(h.sent.length, 2); assert.equal(outcome.entries[2].phase, 'queued');
});
test('sem reconciliação disponível nenhum upload é iniciado', async () => {
  const h = harness(30, { snapshotFail: true }); const outcome = await processImportQueue(h.entries, h.io);
  assert.equal(h.sent.length, 0); assert.equal(outcome.entries.every(e => e.phase === 'queued'), true);
});
test('HTML do Access, JSON inválido e respostas 2xx incompletas nunca confirmam sucesso', async () => {
  assert.throws(() => decodeResponse(200, 'text/html', '<html>Access login</html>'), /inesperada/);
  assert.throws(() => decodeResponse(200, 'application/json', 'broken'), /JSON inválida/);
  for (const status of [400, 401, 403, 408, 413, 429, 500, 502, 503, 504]) assert.throws(() => decodeResponse(status, 'text/html', '<html>error</html>'));
  const h = harness(30, { send: async () => decodeResponse(200, 'text/html', '<html>login</html>') });
  const outcome = await processImportQueue(h.entries, h.io); assert.equal(h.sent.length, 1); assert.equal(outcome.entries[0].phase, 'uncertain');
});
test('contrato XHR exige ID/hash e estados consistentes; timeout e erro são incertos', async () => {
  const original = globalThis.XMLHttpRequest;
  let response, event = 'load'; const e = entry(1);
  class Xhr {
    upload = {}; status = 201; timeout = 0;
    open() {} setRequestHeader() {} getResponseHeader() { return 'application/json'; }
    send() { this.responseText = JSON.stringify(response); this['on' + event](); }
  }
  globalThis.XMLHttpRequest = Xhr;
  try {
    for (response of [{ ok: true }, { ...result(e), documentId: crypto.randomUUID() }, { ...result(e), storage: 'pending' }]) await assert.rejects(uploadPdf(1, e, new File(['pdf'], e.name), false, () => {}), /inválida/);
    response = result(e); assert.equal((await uploadPdf(1, e, new File(['pdf'], e.name), false, () => {})).documentId, e.id);
    for (event of ['timeout', 'error', 'abort']) await assert.rejects(uploadPdf(1, e, new File(['pdf'], e.name), false, () => {}));
  } finally { globalThis.XMLHttpRequest = original; }
});
test('reload restaura fila incerta e consulta hash antes de reenviar', async () => {
  const data = new Map(), storage = { setItem: (k, v) => data.set(k, v), getItem: k => data.get(k) };
  const h = harness(3); h.entries[0].phase = 'sending'; h.saved.set(h.entries[0].id, result(h.entries[0]));
  saveImportQueue(storage, 1, h.entries);
  const restored = restoreImportQueue(storage, 1); assert.equal(restored[0].phase, 'uncertain');
  // Browser lost the File objects. Persisted result is still recovered.
  const recovered = await processImportQueue(restored, { ...h.io, hasFile: () => false }, true);
  assert.equal(h.sent.length, 0); assert.equal(recovered.entries[0].phase, 'confirmed'); assert.match(recovered.entries[1].state, /Selecione novamente/);
  const complete = await processImportQueue(recovered.entries, h.io, true);
  assert.deepEqual(h.sent, ['2.pdf', '3.pdf']); assert.equal(complete.entries.every(e => e.phase === 'confirmed'), true);
});
test('nova seleção com mesmo hash usa registro salvo; duplicata e PDF corrompido têm resultados próprios', async () => {
  const h = harness(3); const old = { ...result(h.entries[0]), documentId: crypto.randomUUID() }; h.saved.set(old.documentId, old);
  h.io.send = async e => ({ ...result(e), ...(e.name === '2.pdf' ? { storage: 'duplicate', code: 'IMPORT_DUPLICATE' } : { analysis: 'failed', code: 'PDF_CORRUPT' }) });
  const outcome = await processImportQueue(h.entries, h.io);
  assert.equal(outcome.entries[0].id, old.documentId); assert.equal(outcome.entries[1].result.storage, 'duplicate'); assert.equal(outcome.entries[2].result.analysis, 'failed');
});
test('reconciliação não confirma um ID com hash divergente', async () => {
  const h = harness(2); h.saved.set(h.entries[0].id, { ...result(h.entries[0]), contentHash: h.entries[1].hash });
  const outcome = await processImportQueue(h.entries, h.io);
  assert.equal(h.sent.length, 0); assert.equal(outcome.entries[0].phase, 'queued'); assert.match(outcome.warning, /não corresponde/);
});
test('seleções repetidas mostram um resultado por arquivo sem criar registros repetidos', async () => {
  const h = harness(2); h.entries[1].hash = h.entries[0].hash;
  const outcome = await processImportQueue(h.entries, h.io);
  assert.equal(h.sent.length, 1); assert.equal(outcome.entries.length, 2); assert.equal(outcome.entries[0].id, outcome.entries[1].id); assert.match(outcome.entries[1].state, /já registrado/);
});
test('hashs sintéticos são estáveis após reabrir arquivos; arquivo inválido rejeitado localmente', async () => {
  const bytes = pdfFixture('synthetic'); const file = new File([bytes], 'document.pdf', { type: 'application/pdf' });
  assert.equal(await identifyFile(file, SMART_DEFAULTS), await identifyFile(new File([bytes], 'renamed.pdf', { type: 'application/pdf' }), SMART_DEFAULTS));
  await assert.rejects(identifyFile(new File(['html'], 'file.html', { type: 'text/html' }), SMART_DEFAULTS));
});
test('pausa aguarda a confirmação do upload ativo e preserva os próximos; retomada não duplica', async () => {
  const h = harness(3); let paused = false, finish;
  const send = h.io.send;
  h.io.shouldPause = () => paused;
  h.io.send = async (...args) => { await new Promise(resolve => { finish = resolve; }); return send(...args); };
  const running = processImportQueue(h.entries, h.io);
  await new Promise(resolve => setImmediate(resolve));
  paused = true; finish();
  const outcome = await running;
  assert.equal(outcome.entries[0].phase, 'confirmed');
  assert.deepEqual(outcome.entries.slice(1).map(e => e.phase), ['queued', 'queued']);
  assert.equal(h.sent.length, 1);
  paused = false; h.io.send = send;
  await processImportQueue(outcome.entries, h.io);
  assert.deepEqual(h.sent, ['1.pdf', '2.pdf', '3.pdf']);
});
test('adicionar arquivos ou continuar sem recuperação explícita não reenvia resultado incerto', async () => {
  const h = harness(3); h.entries[0].phase = 'uncertain';
  const outcome = await processImportQueue(h.entries, h.io);
  assert.deepEqual(h.sent, ['2.pdf', '3.pdf']);
  assert.equal(outcome.entries[0].phase, 'uncertain');
  assert.match(outcome.entries[0].state, /Confira o resultado/);
});
test('um PDF renomeado não contorna a proteção de resultado incerto do mesmo conteúdo', async () => {
  const h = harness(3); h.entries[0].phase = 'uncertain'; h.entries[1].hash = h.entries[0].hash;
  const outcome = await processImportQueue(h.entries, h.io);
  assert.deepEqual(h.sent, ['3.pdf']);
  assert.equal(outcome.entries[0].phase, 'uncertain');
  assert.equal(outcome.entries[1].phase, 'queued');
  const recovered = await processImportQueue(outcome.entries, h.io, true);
  assert.deepEqual(h.sent, ['3.pdf', '1.pdf']);
  assert.equal(recovered.entries[0].id, recovered.entries[1].id);
});
