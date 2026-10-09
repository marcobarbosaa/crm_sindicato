import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { loader } from './smart-test-loader.mjs';
const schedule = loader()('lib/worker-schedule.ts');
const compiled = ts.transpileModule(readFileSync(new URL('../worker.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function loadWorker({ fetch, cleanup, findDue, processCampaign, delivery, findSmart, processSmart, cleanSmart, smartDelivery } = {}) {
  const logs = [], loadedModule = { exports: {} };
  const require = name => {
    if (name === './lib/worker-schedule') return schedule;
    if (name === 'vinext/server/fetch-handler') return { fetch };
    if (name === './lib/gmail-delivery') return { processPendingDeliveryChecks: delivery };
    if (name === './lib/smart-send-runner') return { findDueSmartBatch: findSmart, processSmartBatch: processSmart };
    if (name === './lib/smart-send-service') return { cleanupSmartFiles: cleanSmart };
    if (name === './lib/smart-send-delivery') return { checkSmartDelivery: smartDelivery };
    if (name === './db') return { withCampaignDb: fn => fn() };
    if (name === './lib/attachment-service') return { cleanupAttachments: cleanup };
    if (name === './lib/campaign-runner') return { findDueCampaigns: findDue, processCampaignBatch: processCampaign };
    throw Error(name);
  };
  const logger = Object.fromEntries(['info', 'error'].map(level => [level, v => logs.push({ level, ...v })]));
  new Function('require', 'module', 'exports', 'console', compiled)(require, loadedModule, loadedModule.exports, logger);
  return { worker: loadedModule.exports.default, logs };
}
const atMinute = minute => Date.UTC(2026, 9, 8, 12, minute);
const event = { cron: '*/2 * * * *', scheduledTime: atMinute(4) };
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

test('delivery cron has its own bounded invocation and never sends or cleans attachments', async () => {
 let calls=0; const {worker}=loadWorker({delivery:async()=>{calls++;return {outcome:'checked'}},findDue:()=>assert.fail('must not send'),cleanup:()=>assert.fail('must not mix budgets')});
 await worker.scheduled({...event,scheduledTime:atMinute(0)}); assert.equal(calls,1);
});
test('smart crons have isolated budgets and preserve traditional schedules', async () => {
 const calls=[];
 const {worker}=loadWorker({findSmart:async()=>({id:9,ownerId:'owner'}),processSmart:async(...args)=>calls.push(args),cleanSmart:async()=>({deleted:0}),smartDelivery:async()=>({outcome:'idle'}),findDue:()=>assert.fail('mixed campaigns'),cleanup:()=>assert.fail('mixed cleanup')});
 await worker.scheduled({...event,cron:'1-59/2 * * * *'});assert.deepEqual(calls,[['owner',9]]);
 await worker.scheduled({...event,scheduledTime:atMinute(6)});await worker.scheduled({...event,scheduledTime:atMinute(2)});
});
test('three triggers preserve send cadence and allocate one maintenance task per event for a full day', async () => {
 assert.equal(schedule.WORKER_CRONS.length,3);
 const calls={campaign:0,smart:0,delivery:0,smartDelivery:0,attachments:0,files:0};
 const {worker}=loadWorker({findDue:async()=>{calls.campaign++;return [];},findSmart:async()=>{calls.smart++;return null;},delivery:async()=>{calls.delivery++;return {};},smartDelivery:async()=>{calls.smartDelivery++;return {};},cleanup:async()=>{calls.attachments++;return {deleted:0,pending:0};},cleanSmart:async()=>{calls.files++;return {deleted:0};}});
 for(let minute=0;minute<1440;minute++){
  const scheduledTime=Date.UTC(2026,9,8,0,minute);
  await worker.scheduled({cron:schedule.CAMPAIGN_CRON,scheduledTime});
  if(minute%2)await worker.scheduled({cron:schedule.SMART_SEND_CRON,scheduledTime});
  else{const before=Object.values(calls).reduce((a,b)=>a+b,0);await worker.scheduled({cron:schedule.MAINTENANCE_CRON,scheduledTime});assert.equal(Object.values(calls).reduce((a,b)=>a+b,0)-before,1);}
 }
 assert.deepEqual(calls,{campaign:1440,smart:720,delivery:180,smartDelivery:180,attachments:180,files:180});
});
test('rotation uses scheduled event time and remains stable across restart/repeated delivery', () => {
 for(const [minute,task] of [[0,'delivery'],[2,'smart-delivery'],[4,'attachments'],[6,'smart-files'],[8,'delivery']]){
  assert.equal(schedule.scheduledTask(schedule.MAINTENANCE_CRON,atMinute(minute)),task);
  assert.equal(loader()('lib/worker-schedule.ts').scheduledTask(schedule.MAINTENANCE_CRON,atMinute(minute)),task);
 }
});
test('removed triggers and malformed timestamps do not execute a fallback or send', async () => {
 const {worker,logs}=loadWorker();
 for(const cron of ['*/5 * * * *','3-59/5 * * * *','2-59/3 * * * *','unknown'])await worker.scheduled({...event,cron});
 await worker.scheduled({...event,scheduledTime:NaN});assert.ok(logs.every(l=>l.status==='ignored'));
});
test('failure in a maintenance slot does not run other tasks or block the next slot', async () => {
 let checks=0;
 const {worker}=loadWorker({delivery:async()=>{throw Error('synthetic');},smartDelivery:async()=>{checks++;return {};}});
 await assert.rejects(worker.scheduled({...event,scheduledTime:atMinute(0)}));assert.equal(checks,0);
 await worker.scheduled({...event,scheduledTime:atMinute(2)});assert.equal(checks,1);
});
