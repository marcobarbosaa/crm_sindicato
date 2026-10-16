import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as unpdf from 'unpdf';
import { loader, pdfFixture } from './smart-test-loader.mjs';
const load = loader({ unpdf });
const { readPdfText } = load('lib/pdf-text.ts');
const { matchPdfCompany } = load('lib/pdf-company-matcher.ts');
const { classifyIdentification, approvalState, identificationOverview } = load('components/smart-sends/identification-state.ts');
const companies = [{ id: 1, name: 'Empresa Alfa', tradeName: null, cnpj: '11222333000181' }, { id: 2, name: 'Empresa Beta', tradeName: null, cnpj: '11444777000161' }];
async function document(text, name = 'documento.pdf', catalog = companies, bytes = pdfFixture(text)) {
  const reading = await readPdfText(bytes), match = matchPdfCompany(reading.text, name, catalog);
  const company = catalog.find(company => company.id === match.companyId);
  return { id: crypto.randomUUID(), fileName: name, fileReady: true, fileDeletedAt: null, readable: reading.readable, companyId: match.companyId,
    companyName: company?.name || null, companyCnpj: company?.cnpj || null, recipient: company ? 'valid@example.test' : null,
    extractedCnpjs: match.cnpjs, candidates: match.candidates, identificationMethod: match.method,
    reviewStatus: reading.readable ? match.status : 'READ_ERROR', confirmedAt: null, excluded: false, error: reading.error };
}

test('CNPJ único reconhece sem aprovar; confirmação exige status e data persistidos', async () => {
  const item = await document('Destinataria 11.222.333/0001-81');
  assert.equal(classifyIdentification(item).group, 'unique');
  assert.equal(approvalState(item), 'Aguardando confirmação');
  assert.equal(approvalState({ ...item, reviewStatus: 'READY' }), 'Aguardando confirmação');
  assert.equal(approvalState({ ...item, reviewStatus: 'READY', confirmedAt: '2026-10-16' }), 'Confirmado');
});
test('dois CNPJs exigem revisão mesmo com apenas uma ou nenhuma empresa cadastrada', async () => {
  for (const catalog of [companies, companies.slice(0, 1), []]) {
    const item = await document('Emissor 11444777000161 Destinataria 11222333000181', 'doc.pdf', catalog);
    assert.equal(item.companyId, null); assert.equal(classifyIdentification(item).group, 'review');
    assert.equal(item.extractedCnpjs.length, 2); assert.equal(approvalState(item), 'Requer correção');
  }
});
test('sem CNPJ, CNPJ inválido e empresa ausente ficam sem identificação confiável', async () => {
  for (const item of [await document('Documento sem identificadores'), await document('11222333000180'), await document('11222333000181', 'doc.pdf', [])]) {
    assert.equal(classifyIdentification(item).group, 'unidentified'); assert.equal(item.companyId, null);
  }
});
test('nome semelhante à razão social oferece candidata sem selecionar ou aprovar', async () => {
  const item = await document('Documento mensal', 'Empresa Alfa.pdf');
  assert.equal(classifyIdentification(item).group, 'review'); assert.equal(item.identificationMethod, 'FILENAME');
  assert.deepEqual(item.candidates, [1]); assert.equal(item.companyId, null); assert.equal(item.confirmedAt, null);
});
test('texto insuficiente e documento corrompido têm motivos próprios e não são aprovados', async () => {
  const empty = await document('');
  assert.equal(classifyIdentification(empty).group, 'problem'); assert.match(classifyIdentification(empty).reason, /Texto insuficiente/);
  assert.notEqual(approvalState(empty), 'Confirmado');
  const corrupt = await document('', 'doc.pdf', companies, new TextEncoder().encode('%PDF-broken'));
  assert.equal(classifyIdentification(corrupt).group, 'problem'); assert.equal(approvalState(corrupt), 'Bloqueado');
});
test('vários documentos da mesma empresa são preservados e empresa é contada uma vez', async () => {
  const item = await document('11222333000181');
  const rows = Array.from({ length: 500 }, (_, index) => ({ ...item, id: String(index) }));
  const before = structuredClone(rows), overview = identificationOverview(rows);
  assert.equal(overview.documents, 500); assert.equal(overview.companies, 1); assert.equal(overview.groups.unique.length, 500);
  assert.deepEqual(rows, before, 'derivar apresentação não altera os documentos');
});
test('reconhecimento permanece separado dos bloqueios de destinatário', async () => {
  const item = await document('11222333000181');
  for (const changes of [{ recipient: null, reviewStatus: 'NO_EMAIL' }, { recipient: 'broken', reviewStatus: 'INVALID_EMAIL' }, { reviewStatus: 'INVALID_EMAIL' }]) {
    const invalid = { ...item, ...changes };
    assert.equal(classifyIdentification(invalid).group, 'unique'); assert.equal(approvalState(invalid), 'Requer correção');
    assert.equal(identificationOverview([invalid]).withoutRecipient, 1);
  }
  for (const changes of [{ excluded: true }, { fileDeletedAt: '2026-10-16' }, { reviewStatus: 'DUPLICATE' }]) assert.equal(approvalState({ ...item, ...changes }), 'Bloqueado');
});
