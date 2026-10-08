import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loader, pdfFixture } from './smart-test-loader.mjs';
import * as unpdf from 'unpdf';
const load = loader({ unpdf });
const { readPdfText } = load('lib/pdf-text.ts');
const { matchPdfCompany, validCnpj } = load('lib/pdf-company-matcher.ts');
const { recipientReview, validateSmartFile, recoverSmartStatus, csvCell } = load('lib/smart-send-policy.ts');
const companies = [{ id: 1, name: 'Empresa Alfa', tradeName: 'Alfa', cnpj: '11222333000181' }, { id: 2, name: 'Empresa Beta', tradeName: 'Beta', cnpj: '11444777000161' }];
test('PDF textual com único CNPJ válido, formatado e não formatado', async () => {
  for (const value of ['11.222.333/0001-81', '11222333000181']) {
    const reading = await readPdfText(pdfFixture(`Destinataria ${value}`));
    assert.equal(reading.error, null); assert.equal(matchPdfCompany(reading.text, 'doc.pdf', companies).companyId, 1);
  }
  assert.equal(validCnpj('11222333000180'), false); assert.equal(validCnpj('00000000000000'), false);
});
test('múltiplos CNPJs nunca selecionam arbitrariamente, mesmo com contexto', () => {
  const result = matchPdfCompany('Emissor 11444777000161 Destinataria 11222333000181', 'doc.pdf', companies);
  assert.equal(result.companyId, null); assert.equal(result.status, 'REVIEW_REQUIRED'); assert.equal(result.candidates.length, 2);
});
test('sem CNPJ, nome exato ou ambíguo são apenas sugestões', () => {
  assert.equal(matchPdfCompany('', 'Empresa Alfa.pdf', companies).companyId, null);
  assert.deepEqual(matchPdfCompany('', 'Empresa Alfa.pdf', companies).candidates, [1]);
  assert.equal(matchPdfCompany('', 'Empresa Alfa Beta.pdf', companies).candidates.length, 2);
  assert.equal(matchPdfCompany('', 'sem correspondencia.pdf', companies).status, 'REVIEW_REQUIRED');
});
test('empresa inexistente', () => assert.equal(matchPdfCompany('11222333000181', 'doc.pdf', []).status, 'COMPANY_NOT_FOUND'));
test('PDF corrompido, protegido e sem camada textual', async () => {
  assert.equal((await readPdfText(new TextEncoder().encode('%PDF-broken'))).error, 'PDF_CORRUPT');
  assert.equal((await readPdfText(pdfFixture('secret', true))).error, 'PDF_PASSWORD');
  const empty = await readPdfText(pdfFixture()); assert.equal(empty.error, 'PDF_NO_TEXT'); assert.equal(empty.readable, true);
});
test('empresas sem e-mail e com endereço inválido são bloqueadas', () => {
  assert.equal(recipientReview({ primaryEmail: null, primaryEmailStatus: 'UNKNOWN' }), 'NO_EMAIL');
  assert.equal(recipientReview({ primaryEmail: 'valid@example.test', primaryEmailStatus: 'INVALID' }), 'INVALID_EMAIL');
  assert.equal(recipientReview({ primaryEmail: 'a@example.test\r\nBcc:other@example.test', primaryEmailStatus: 'UNKNOWN' }), 'INVALID_EMAIL');
});
test('validação de MIME, extensão, tamanho e caminho', () => {
  const good = { name: 'doc.pdf', type: 'application/pdf', size: 30 }; validateSmartFile(good);
  for (const change of [{ name: '../doc.pdf' }, { type: 'text/plain' }, { size: 0 }, { name: 'doc.exe' }, { size: 9 * 1024 * 1024 }]) assert.throws(() => validateSmartFile({ ...good, ...change }));
});
test('reinicialização nunca reenvia SENDING/UNCERTAIN e respeita cancelamento', () => {
  for (const status of ['SENDING', 'UNCERTAIN', 'QUEUED']) assert.equal(recoverSmartStatus(status), 'UNCERTAIN');
  assert.equal(recoverSmartStatus('PREPARED'), 'PENDING'); assert.equal(recoverSmartStatus('PREPARED', true), 'SKIPPED');
  assert.equal(recoverSmartStatus('SENT'), 'SENT'); assert.equal(csvCell('=cmd'), '"\'=cmd"');
});
