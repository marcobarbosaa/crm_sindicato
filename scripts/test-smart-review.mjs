import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loader } from './smart-test-loader.mjs';
const load = loader();
const { filterReview, canConfirm, canAssociate } = load('components/smart-sends/review-state.ts');
const { reviewState, reviewOverview } = load('lib/smart-review-policy.ts');
const item = { id: 'one', fileName: 'Contribuição Alfa.pdf', fileSize: 100, fileReady: true, fileDeletedAt: null, readable: true, companyId: 1, companyName: 'Empresa Alfa', companyCnpj: '11.222.333/0001-81', recipient: 'alfa@example.test', extractedCnpjs: ['11222333000181'], candidates: [1], identificationMethod: 'CNPJ', reviewStatus: 'IDENTIFIED', confirmedAt: null, excluded: false, error: null };

test('reconhecimento único não é confirmação; confirmação depende do retorno persistido', () => {
  assert.equal(reviewState(item), 'pending'); assert.equal(canConfirm(item), true);
  assert.equal(reviewState({ ...item, reviewStatus: 'READY' }), 'pending');
  const confirmed = { ...item, reviewStatus: 'READY', confirmedAt: '2026-10-16' };
  assert.equal(reviewState(confirmed), 'confirmed'); assert.equal(canConfirm(confirmed), false);
});
test('vários CNPJs permitem seleção manual e exigem confirmação posterior', () => {
  const multiple = { ...item, companyId: null, reviewStatus: 'REVIEW_REQUIRED', extractedCnpjs: ['11222333000181', '11444777000161'] };
  assert.equal(canAssociate(multiple), true); assert.equal(canConfirm(multiple), false);
  assert.equal(canConfirm({ ...multiple, companyId: 1, reviewStatus: 'IDENTIFIED', identificationMethod: 'MANUAL' }), true);
});
test('sem e-mail, e-mail inválido, duplicata e arquivo indisponível nunca habilitam confirmação', () => {
  for (const change of [{ recipient: null }, { recipient: 'bad' }, { reviewStatus: 'INVALID_EMAIL' }, { reviewStatus: 'NO_EMAIL' }, { reviewStatus: 'DUPLICATE' }, { duplicateOf: 'other' }, { fileReady: false }, { fileDeletedAt: '2026-10-16' }, { readable: false }]) {
    const blocked = { ...item, ...change };
    assert.equal(reviewState(blocked), 'blocked'); assert.equal(canConfirm(blocked), false);
  }
  assert.equal(reviewState({ ...item, excluded: true }), 'excluded'); assert.equal(canConfirm({ ...item, excluded: true }), false);
});
test('pesquisas por documento, empresa, fantasia e CNPJ não alteram registros', () => {
  const rows = [item, { ...item, id: 'two', fileName: 'outro.pdf', companyId: null, companyName: null, companyCnpj: null, recipient: null, suggestions: [{ id: 2, name: 'Empresa Beta', tradeName: 'Fantasia', cnpj: '11.444.777/0001-61', primaryEmail: null }] }];
  const before = structuredClone(rows);
  assert.deepEqual(filterReview(rows, 'contribuicao', '', 'all'), [item]);
  for (const term of ['Alfa', '11222333', '11.222.333']) assert.deepEqual(filterReview(rows, '', term, 'all'), [item]);
  assert.equal(filterReview(rows, '', 'Fantasia', 'all')[0].id, 'two');
  assert.equal(filterReview(rows, '', '', 'no-email')[0].id, 'two');
  assert.deepEqual(rows, before);
});
test('indicadores particionam 100 documentos e filtros mantêm confirmados, bloqueados e excluídos distintos', () => {
  const rows = Array.from({ length: 100 }, (_, n) => ({ ...item, id: String(n), ...(n < 40 ? { reviewStatus: 'READY', confirmedAt: '2026-10-16' } : n < 60 ? { reviewStatus: 'DUPLICATE' } : n < 70 ? { excluded: true } : {}) }));
  assert.deepEqual(reviewOverview(rows), { total: 100, confirmed: 40, blocked: 20, excluded: 10, pending: 30 });
  for (const [filter, count] of [['confirmed', 40], ['pending', 30], ['blocked', 20], ['excluded', 10], ['duplicate', 20]]) assert.equal(filterReview(rows, '', '', filter).length, count);
});
