import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loader } from './smart-test-loader.mjs';
const { importRows, canIdentify, canRemoveUpload } = loader()('components/smart-sends/import-state.ts');
const entry = { id: 'local', name: 'arquivo.pdf', size: 100, progress: 100, phase: 'confirmed', state: 'Confirmado', result: { documentId: 'saved', storage: 'stored', analysis: 'complete', message: 'PDF salvo e analisado.' } };
const document = { id: 'saved', fileName: 'arquivo.pdf', fileSize: 100, fileReady: true, fileDeletedAt: null, readable: true, reviewStatus: 'IDENTIFIED', excluded: false };
test('resumo não duplica documento confirmado que também veio do servidor', () => {
  assert.equal(importRows([entry], [document]).length, 1);
  assert.equal(importRows([], [document])[0].status, 'complete');
});
test('confirmação de persistência não mascara erro de leitura, duplicação ou recuperação', () => {
  for (const result of [{ ...entry.result, analysis: 'failed' }, { ...entry.result, storage: 'duplicate' }, { ...entry.result, storage: 'deleted' }]) {
    assert.equal(importRows([{ ...entry, result }], [])[0].status, 'failed');
  }
  assert.equal(importRows([{ ...entry, phase: 'uncertain' }], [])[0].status, 'failed');
  assert.equal(importRows([{ ...entry, phase: 'sending' }], [])[0].label, 'Analisando');
});
test('apenas documentos disponíveis e legíveis habilitam identificação', () => {
  assert.equal(canIdentify(document), true);
  for (const changes of [{ readable: false }, { fileReady: false }, { fileDeletedAt: 'expired' }, { excluded: true }, { reviewStatus: 'DUPLICATE' }, { reviewStatus: 'UPLOADING' }]) assert.equal(canIdentify({ ...document, ...changes }), false);
});
test('remoção local só está disponível antes do envio', () => {
  const queued = { ...entry, phase: 'queued', result: undefined, progress: 0 };
  assert.equal(canRemoveUpload(queued), true);
  for (const changes of [{ phase: 'uncertain' }, { phase: 'sending' }, { progress: 10 }, { result: entry.result }]) assert.equal(canRemoveUpload({ ...queued, ...changes }), false);
});
