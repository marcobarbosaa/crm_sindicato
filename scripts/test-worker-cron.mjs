import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
const compiled = ts.transpileModule(readFileSync(new URL('../worker.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function loadWorker({ fetch, cleanup, findDue, processCampaign } = {}) {
  const logs = [], loadedModule = { exports: {} };
  const require = name => {
    if (name === 'vinext/server/fetch-handler') return { fetch };
    if (name === './db') return { withCampaignDb: fn => fn() };
    if (name === './lib/attachment-service') return { cleanupAttachments: cleanup };
    if (name === './lib/campaign-runner') return { findDueCampaigns: findDue, processCampaignBatch: processCampaign };
    throw Error(name);
  };
  const logger = Object.fromEntries(['info', 'error'].map(level => [level, v => logs.push({ level, ...v })]));
  new Function('require', 'module', 'exports', 'console', compiled)(require, loadedModule, loadedModule.exports, logger);
  return { worker: loadedModule.exports.default, logs };
}
const event = { cron: '*/5 * * * *', scheduledTime: 1800000000000 };
test('HTTP delegates request, env and context unchanged', async () => {
  const request = new Request('https://example.test'), env = {}, ctx = {}, response = new Response('OK');
  const { worker } = loadWorker({ fetch: (...args) => { assert.deepEqual(args, [request, env, ctx]); return response; } });
  assert.equal(await worker.fetch(request, env, ctx), response);
});
test('cleanup awaits completion and does not process campaigns in that invocation', async () => {
  let release, started;
  const called = new Promise(resolve => { started = resolve; });
  const { worker, logs } = loadWorker({ cleanup: () => { started(); return new Promise(resolve => { release = resolve; }); }, findDue: () => assert.fail('mixed budgets') });
  let finished = false;
  const execution = worker.scheduled(event).then(() => { finished = true; });
  await called; assert.equal(finished, false); release({ deleted: 3, pending: 0 }); await execution;
  assert.equal(logs.at(-1).status, 'completed'); assert.equal(logs.at(-1).deleted, 3);
});
test('campaign cron processes one chunk and never runs cleanup', async () => {
  const calls = [];
  const { worker } = loadWorker({ cleanup: () => assert.fail('mixed budgets'), findDue: async limit => { assert.equal(limit, 1); return [{ id: 7, ownerId: 'owner' }]; },
    processCampaign: async (...args) => calls.push(args) });
  await worker.scheduled({ ...event, cron: '* * * * *' }); assert.deepEqual(calls, [['owner', 7]]);
});
test('provider details never appear in errors/logs', async () => {
  const secret = 'postgres://private-password@private-host/db';
  const { worker, logs } = loadWorker({ cleanup: async () => { throw Error(secret); } });
  await assert.rejects(worker.scheduled(event), /Scheduled maintenance failed/); assert.equal(JSON.stringify(logs).includes(secret), false);
});
test('partial cleanup fails the event and does not retry in a loop', async () => {
  let calls = 0;
  const { worker, logs } = loadWorker({ cleanup: async () => { calls++; return { deleted: 2, pending: 1 }; } });
  await assert.rejects(worker.scheduled(event), /Scheduled maintenance failed/); assert.equal(calls, 1); assert.ok(logs.some(l => l.status === 'partial' && l.pending === 1));
});
test('empty campaign schedule does not send or clean attachments', async () => {
  const { worker } = loadWorker({ findDue: async () => [], cleanup: () => assert.fail(), processCampaign: () => assert.fail() });
  await worker.scheduled({ ...event, cron: '* * * * *' });
});
