import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loader } from './smart-test-loader.mjs';
const { eligibleItems, sendCounts, canResume, formatSendTime, scheduledTime, filterSends } = loader()('components/smart-sends/send-view-state.ts');
const item = { id: 'one', fileName: 'Contribuição.pdf', companyId: 1, companyName: 'Empresa Alfa', recipient: 'alfa@example.test', reviewStatus: 'READY', confirmedAt: '2026-10-16T12:00:00Z', fileReady: true, readable: true, excluded: false, fileDeletedAt: null, sendStatus: 'PENDING', deliveryStatus: 'PENDING' };
test('dois PDFs da mesma empresa mantêm duas mensagens e bloqueados nunca entram na relação final', () => {
  const rows = [item, { ...item, id: 'two' }, ...[{ excluded: true }, { duplicateOf: 'one' }, { confirmedAt: null }, { recipient: null }, { readable: false }, { fileReady: false }, { reviewStatus: 'INVALID_EMAIL' }].map((change, n) => ({ ...item, id: 'blocked' + n, ...change }))];
  assert.deepEqual(eligibleItems(rows).map(row => row.id), ['one', 'two']);
});
test('progresso distingue aceitação, falha, ignorado e incerto', () => {
  const states = ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED', 'UNCERTAIN'];
  const result = sendCounts(states.map(sendStatus => ({ ...item, sendStatus })));
  assert.equal(result.finished, 4); for (const state of states) assert.equal(result.counts[state], 1);
});
test('retomada nunca permite mensagens incertas ou processamento ativo', () => {
  assert.equal(canResume({ status: 'PAUSED' }, [item]), true);
  for (const state of ['UNCERTAIN', 'PROCESSING']) assert.equal(canResume({ status: 'PAUSED' }, [{ ...item, sendStatus: state }]), false);
  assert.equal(canResume({ status: 'RUNNING' }, [item]), false);
});
test('horários vêm do servidor; estado parado, data inválida e ausência não geram previsão', () => {
  for (const status of ['PAUSED', 'COMPLETED', 'CANCELLED']) assert.equal(scheduledTime({ status, nextRunAt: '2026-10-16T12:00:00Z' }), null);
  for (const nextRunAt of [null, undefined, 'bad']) assert.equal(scheduledTime({ status: 'RUNNING', nextRunAt }), null);
  assert.match(scheduledTime({ status: 'RUNNING', nextRunAt: '2026-10-16T12:00:00Z' }, 'America/Sao_Paulo'), /09:00:00/);
  assert.equal(formatSendTime(null), 'Não informado');
});
test('filtros de 100 documentos pesquisam nomes e e-mails sem alterar registros', () => {
  const rows = Array.from({ length: 100 }, (_, n) => ({ ...item, id: String(n), fileName: `Documento ${n}.pdf`, sendStatus: n < 30 ? 'SENT' : 'PENDING', deliveryStatus: n < 10 ? 'BOUNCED' : 'PENDING' }));
  const before = structuredClone(rows);
  assert.equal(filterSends(rows, '', 'SENT', 'all').length, 30);
  assert.equal(filterSends(rows, 'alfa@example', 'SENT', 'BOUNCED').length, 10);
  assert.equal(filterSends(rows, 'Documento 99', 'all', 'all')[0].id, '99');
  assert.deepEqual(rows, before);
});
