import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Execute the actual runner and counters with an in-memory relational adapter.
// Transactions roll back; faults can occur before a query or after COMMIT.
const compiled = new Map();
function compile(path) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(readFileSync(new URL('../' + path + '.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  return compiled.get(path);
}
function fixture(count = 25, options = {}) {
  let now = Date.parse('2026-09-30T12:00:00Z');
  const RealDate = Date;
  class Clock extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const names = ['emailCampaigns', 'emailCampaignRecipients', 'emailMessages', 'crmSettings', 'emailAccounts', 'emailTemplates', 'activityLogs', 'campaignOwnerLeases'];
  const schema = Object.fromEntries(names.map(name => [name, new Proxy({ table: name }, { get: (t, key) => key === 'table' ? t.table : { table: t.table, column: key } })]));
  let state = Object.fromEntries(names.map(name => [name, []]));
  state.emailCampaigns.push({ id: 1, ownerId: 'local-preview-user', status: 'RUNNING', batchSize: 25, intervalMinutes: 10, templateId: 1, logicalBatch: null, nextRunAt: null, lockUntil: null, updatedAt: new Clock() });
  for (let id = 1; id <= count; id++) state.emailCampaignRecipients.push({ id, campaignId: 1, recipient: `r${id}@example.test`, companyId: id, status: 'PENDING', attempts: 0, lastBatchId: null, personalization: {}, messageId: null, processingStartedAt: null });
  state.crmSettings.push({ ownerId: 'local-preview-user', dailySendLimit: options.dailyLimit || 100 });
  state.emailAccounts.push({ ownerId: 'local-preview-user', provider: 'GMAIL', scopes: 'https://www.googleapis.com/auth/gmail.send', email: 'sender@example.test', encryptedRefreshToken: 'secret' });
  state.emailTemplates.push({ id: 1, ownerId: 'local-preview-user', subject: 'Subject', body: 'Body' });
  const calls = [], logs = [], queries = [];
  let attachments = 0, refreshes = 0;
  const value = (v, ctx) => v?.column ? ctx[v.table]?.[v.column] : v?.scalar !== undefined ? v.scalar : v;
  const op = fn => (a, b) => ctx => fn(value(a, ctx), value(b, ctx));
  const orm = {
    eq: op((a, b) => a instanceof Date || b instanceof Date ? +a === +b : a === b),
    ne: op((a, b) => a !== b), gte: op((a, b) => a != null && +a >= +b), lte: op((a, b) => a != null && +a <= +b),
    and: (...xs) => ctx => xs.filter(Boolean).every(x => x(ctx)), or: (...xs) => ctx => xs.filter(Boolean).some(x => x(ctx)),
    isNull: a => ctx => value(a, ctx) == null, inArray: (a, list) => ctx => list.includes(value(a, ctx)), asc: a => a,
    sql: (strings, ...values) => strings.join('').includes('greatest') ? { compute: ctx => new Clock(Math.max(+ctx.emailCampaigns.nextRunAt || 0, values[1])) } : strings.join('').includes('count(*)') ? { count: true } : strings.join('').includes('exists')
      ? strings.join('').includes("= 'RUNNING'") ? () => state.emailCampaigns.some(c => c.id === values[2] && c.status === 'RUNNING' && +c.lockUntil === values[5]) : ctx => state.emailCampaignRecipients.some(r => r.campaignId === ctx.emailCampaigns.id && r.status === 'PROCESSING' && +r.processingStartedAt <= now - 600000)
      : { scalar: values[0] },
  };
  class Query {
    constructor(kind, table, projection) { Object.assign(this, { kind, table, projection, take: Infinity }); }
    from(table) { this.table = table; return this; }
    where(predicate) { this.predicate = predicate; return this; }
    limit(n) { this.take = n; return this; }
    orderBy(...cols) { this.order = cols; return this; }
    groupBy(col) { this.group = col; return this; }
    leftJoin(table, predicate) { this.join = { table, predicate }; return this; }
    set(data) { this.data = data; return this; }
    values(data) { this.data = data; return this; }
    onConflictDoUpdate(conflict) { this.conflict = conflict; return this; }
    returning() { return this; }
    for() { return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
    execute() {
      const table = this.table.table;
      queries.push({ kind: this.kind, table, data: this.data });
      options.beforeQuery?.(this, api);
      let contexts = state[table].map(row => ({ [table]: row }));
      if (this.kind === 'insert') {
        const existing = this.conflict && state[table].find(row => row[this.conflict.target.column] === this.data[this.conflict.target.column]);
        if (existing) {
          if (!this.conflict.setWhere({ [table]: existing })) return [];
          Object.assign(existing, this.conflict.set); return [structuredClone(existing)];
        }
        const row = { id: Math.max(0, ...state[table].map(r => r.id || 0)) + 1, ...this.data };
        state[table].push(row); return [structuredClone(row)];
      }
      if (this.join) contexts = contexts.map(ctx => ({ ...ctx, [this.join.table.table]: state[this.join.table.table].find(row => this.join.predicate({ ...ctx, [this.join.table.table]: row })) || null }));
      contexts = contexts.filter(ctx => !this.predicate || this.predicate(ctx));
      if (this.order) contexts.sort((a, b) => { for (const c of this.order) { const x = value(c, a), y = value(c, b); if (x > y) return 1; if (x < y) return -1; } return 0; });
      contexts = contexts.slice(0, this.take);
      if (this.kind === 'update') { contexts.forEach(ctx => Object.assign(ctx[table], Object.fromEntries(Object.entries(this.data).map(([key, val]) => [key, val?.compute ? val.compute(ctx) : val])))); options.afterQuery?.(this, api); return structuredClone(contexts.map(ctx => ctx[table])); }
      if (this.kind === 'delete') { state[table] = state[table].filter(row => !contexts.some(ctx => ctx[table] === row)); return []; }
      const project = (ctx, total) => this.projection ? Object.fromEntries(Object.entries(this.projection).map(([key, col]) => [key, col.count === true ? total : typeof col.column === "string" ? value(col, ctx) : ctx[col.table]])) : ctx[table];
      if (this.group) {
        const groups = new Map(); contexts.forEach(ctx => { const key = value(this.group, ctx); groups.set(key, [...(groups.get(key) || []), ctx]); });
        return structuredClone([...groups.values()].map(group => project(group[0], group.length)));
      }
      if (Object.values(this.projection || {}).some(col => col.count === true)) return [project(contexts[0] || {}, contexts.length)];
      return structuredClone(contexts.map(ctx => project(ctx)));
    }
  }
  const db = { select: projection => new Query('select', null, projection), update: table => new Query('update', table), insert: table => new Query('insert', table), delete: table => new Query('delete', table),
    transaction: async fn => { const snapshot = structuredClone(state); let result; try { result = await fn(db); } catch (error) { state = snapshot; throw error; } options.afterCommit?.(api); return result; },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const loadedModule = { exports: {} };
    const require = name => {
      if (name === 'next/server') return { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } };
      if (name === 'drizzle-orm') return orm;
      if (name === '@/db/schema') return schema;
      if (name === '@/db') return { getDb: () => db, withCampaignDb: fn => fn() };
      if (name === '@/lib/settings') return { sendingDayWindow: () => { const start = new Clock(now); start.setUTCHours(0, 0, 0, 0); return { start, next: new Clock(+start + 86400000) }; } };
      if (name === '@/lib/attachment-service') return { loadSendAttachments: async () => { attachments++; if (options.attachmentError) throw Error('Too many subrequests'); return []; } };
      if (name === '@/lib/gmail') return { GmailOAuthError: load('lib/gmail').GmailOAuthError, decryptToken: async () => 'secret', refreshAccessToken: async () => { refreshes++; if(options.oauthFailure) throw new (load('lib/gmail').GmailOAuthError)(options.oauthFailure.status,options.oauthFailure.code); return 'secret'; }, encodeRawEmail: args => { options.encode?.(api); return args.to; } };
      if (name.startsWith('@/')) return load(name.slice(2));
      throw Error(name);
    };
    const fetch = async (_url, init) => { const recipient = JSON.parse(init.body).raw; calls.push(recipient); return options.gmail ? options.gmail(api, recipient) : { ok: true, status: 200, json: async () => ({ id: 'gmail-' + recipient }) }; };
    const logger = { info: v => logs.push(v), error: v => logs.push(v) };
    new Function('require', 'module', 'exports', 'fetch', 'console', 'Date', compile(path))(require, loadedModule, loadedModule.exports, fetch, logger, Clock);
    cache.set(path, loadedModule.exports); return loadedModule.exports;
  }
  const api = { get state() { return state; }, calls, logs, queries, get campaign() { return state.emailCampaigns[0]; }, get recipients() { return state.emailCampaignRecipients; },
    control: action => load('app/api/email-campaigns/[id]/control/route').POST({ json: async () => ({ action }) }, { params: Promise.resolve({ id: '1' }) }),
    review: (action, recipientId = 1) => load('app/api/email-campaigns/[id]/review/route').POST({ json: async () => ({ action, recipientId }) }, { params: Promise.resolve({ id: '1' }) }),
    advance: ms => { now += ms; }, get now() { return now; }, get attachments() { return attachments; }, get refreshes() { return refreshes; },
    run: () => load('lib/campaign-runner').processCampaignBatch('local-preview-user', 1), due: () => load('lib/campaign-runner').findDueCampaigns(),
    sentExactlyOnce() { assert.equal(new Set(calls).size, calls.length); assert.equal(state.emailCampaignRecipients.length, count); },
  };
  return api;
}
const rejection = status => ({ ok: false, status, json: async () => ({ error: { message: 'Provider failure' } }) });

test('25 recipients use five invocations, attachments/token once per chunk; last batch completes', async () => {
  const f = fixture();
  for (let i = 1; i <= 5; i++) { await f.run(); assert.equal(f.calls.length, i * 5); if (i < 5) { assert.equal(f.campaign.nextRunAt.getTime(), f.now); assert.equal(f.campaign.logicalBatch.recipientIds.length, 25); } }
  assert.equal(f.campaign.status, 'COMPLETED'); assert.equal(f.attachments, 5); assert.equal(f.refreshes, 5); f.sentExactlyOnce();
});
test('10 minutes occur between logical batches, last batch may have only two recipients', async () => {
  const f = fixture(27); for (let i = 0; i < 5; i++) await f.run();
  assert.equal(f.campaign.nextRunAt.getTime(), f.now + 600000); assert.equal(f.campaign.logicalBatch, null);
  assert.equal((await f.run()).locked, true); f.advance(600000); await f.run();
  assert.equal(f.calls.length, 27); assert.equal(f.campaign.status, 'COMPLETED'); f.sentExactlyOnce();
});
test('technical deadline interrupts a batch and resumes remaining recipients', async () => {
  const f = fixture(9, { gmail: async f => { f.advance(31000); return { ok: true, status: 200, json: async () => ({ id: 'sent' }) }; } });
  await f.run(); assert.equal(f.calls.length, 2); assert.equal(f.recipients.filter(r => r.status === 'PENDING').length, 7);
  for (let i = 0; i < 4; i++) await f.run(); assert.equal(f.calls.length, 9); f.sentExactlyOnce();
});
test('subrequest exhaustion before fetch stays PENDING, stops chunk, consumes no attempt', async () => {
  let once = true;
  const f = fixture(6, { encode: f => { if (once && f.calls.length === 2) { once = false; throw Error('Too many subrequests by single Worker invocation'); } } });
  await f.run(); assert.equal(f.calls.length, 2); assert.equal(f.recipients[2].status, 'PENDING'); assert.equal(f.recipients[2].attempts, 0);
  assert.equal(f.recipients[2].failureCategory, 'INFRASTRUCTURE_FAILURE'); await f.run(); f.sentExactlyOnce(); assert.equal(f.calls.length, 6);
});
for (const status of [408, 429, 500, 503]) test(`Gmail ${status} retries only in a later logical batch, up to MAX_ATTEMPTS`, async () => {
  const f = fixture(1, { gmail: async () => rejection(status) });
  for (let attempt = 1; attempt <= 3; attempt++) { await f.run(); assert.equal(f.recipients[0].attempts, attempt); assert.equal(f.recipients[0].status, attempt < 3 ? 'PENDING' : 'FAILED'); f.advance(600000); }
  await f.run(); assert.equal(f.calls.length, 3); assert.equal(f.campaign.status, 'COMPLETED');
});
test('confirmed permanent Gmail rejection is FAILED', async () => {
  const f = fixture(1, { gmail: async () => rejection(400) }); await f.run(); assert.equal(f.recipients[0].status, 'FAILED'); assert.equal(f.recipients[0].failureCategory, 'PERMANENT_PROVIDER_FAILURE');
});
test('exception during fetch is UNCERTAIN; subsequent invocation never resends', async () => {
  const f = fixture(5, { gmail: async () => { throw Error('Too many subrequests'); } }); await f.run();
  assert.equal(f.recipients[0].status, 'UNCERTAIN'); assert.equal(f.campaign.status, 'PAUSED'); await f.run();
  assert.equal(f.calls.length, 1); assert.equal(f.recipients.filter(r => r.status === 'PENDING').length, 4); f.sentExactlyOnce();
});
test('Gmail accepted but malformed JSON remains UNCERTAIN', async () => {
  const f = fixture(1, { gmail: async () => ({ ok: true, status: 200, json: async () => { throw Error('bad JSON'); } }) }); await f.run(); assert.equal(f.recipients[0].status, 'UNCERTAIN');
});
test('already SENT recipient is never selected', async () => {
  const f = fixture(3); f.recipients[0].status = 'SENT'; await f.run(); assert.equal(f.calls.length, 2); assert.ok(!f.calls.includes('r1@example.test')); f.sentExactlyOnce();
});
test('duplicate detection skips existing SENT message', async () => {
  const f = fixture(2); f.state.emailMessages.push({ id: 1, ownerId: 'local-preview-user', recipient: 'r1@example.test', subject: 'Subject', status: 'SENT', createdAt: new Date(f.now), sentAt: new Date(f.now) });
  await f.run(); assert.equal(f.recipients[0].status, 'SKIPPED'); assert.equal(f.calls.length, 1); f.sentExactlyOnce();
});
for (const status of ['PAUSED', 'CANCELLED']) test(`${status} during processing stops before next send`, async () => {
  const f = fixture(5, { gmail: async f => { f.campaign.status = status; return { ok: true, status: 200, json: async () => ({ id: 'sent' }) }; } });
  await f.run(); assert.equal(f.calls.length, 1); assert.equal(f.campaign.status, status); assert.equal(f.recipients.filter(r => r.status === 'PENDING').length, 4); f.sentExactlyOnce();
});
test('daily limit stops inside logical batch and resumes in next daily window', async () => {
  const f = fixture(5, { dailyLimit: 2 }); await f.run(); assert.equal(f.calls.length, 2);
  const id = f.campaign.logicalBatch.id; await f.run(); assert.equal(f.calls.length, 2); assert.ok(f.campaign.nextRunAt.getTime() > f.now);
  f.advance(86400000); await f.run(); assert.equal(f.calls.length, 4); assert.equal(f.campaign.logicalBatch.id, id); f.sentExactlyOnce();
});
for (const [messageStatus, expected] of [[null, 'PENDING'], ['PREPARED', 'PENDING'], ['QUEUED', 'UNCERTAIN'], ['SENDING', 'UNCERTAIN'], ['UNCERTAIN', 'UNCERTAIN'], ['SENT', 'SENT'], ['FAILED', 'FAILED']]) {
  test(`stale PROCESSING with ${messageStatus} recovers to ${expected} in maintenance-only invocation`, async () => {
    const f = fixture(1); Object.assign(f.recipients[0], { status: 'PROCESSING', processingStartedAt: new Date(f.now - 660000), messageId: messageStatus ? 1 : null });
    if (messageStatus) f.state.emailMessages.push({ id: 1, status: messageStatus, providerMessageId: messageStatus === 'SENT' ? 'sent-id' : null });
    await f.run(); assert.equal(f.recipients[0].status, expected); assert.equal(f.calls.length, 0);
  });
}
test('paused/cancelled campaigns with stale recipients remain eligible for recovery', async () => {
  for (const status of ['PAUSED', 'CANCELLED']) { const f = fixture(1); f.campaign.status = status; Object.assign(f.recipients[0], { status: 'PROCESSING', processingStartedAt: new Date(f.now - 660000) });
    assert.equal((await f.due()).length, 1); await f.run(); assert.equal(f.recipients[0].status, 'PENDING'); assert.equal(f.campaign.status, status); }
});
test('attachment infrastructure failure never marks recipients FAILED', async () => {
  const f = fixture(25, { attachmentError: true }); await f.run(); assert.ok(f.recipients.every(r => r.status === 'PENDING')); assert.equal(f.calls.length, 0); assert.match(f.campaign.processingNotice, /Processamento adiado/);
});
test('failed send-barrier transaction remains safe to retry before Gmail', async () => {
  let fail = true;
  const f = fixture(1, { beforeQuery: q => { if (fail && q.kind === 'update' && q.table.table === 'emailMessages' && q.data.status === 'SENDING') { fail = false; throw Error('Too many subrequests'); } } });
  await f.run(); assert.equal(f.calls.length, 0); assert.equal(f.recipients[0].status, 'PENDING'); assert.equal(f.recipients[0].attempts, 0); await f.run(); assert.equal(f.calls.length, 1); f.sentExactlyOnce();
});
test('lost successful COMMIT acknowledgement cannot overwrite SENT or resend', async () => {
  let fail = true;
  const f = fixture(1, { afterCommit: f => { if (fail && f.recipients[0].status === 'SENT') { fail = false; throw Error('connection closed'); } } });
  await f.run(); assert.equal(f.recipients[0].status, 'SENT'); assert.equal(f.state.emailMessages[0].status, 'SENT'); await f.run(); assert.equal(f.calls.length, 1); f.sentExactlyOnce();
});
test('total database outage after fetch is recovered conservatively on a fresh invocation', async () => {
  let outage = false;
  const f = fixture(2, { gmail: async () => { outage = true; throw Error('connection lost'); }, beforeQuery: () => { if (outage) throw Error('Too many subrequests'); } });
  await f.run(); assert.equal(f.recipients[0].status, 'PROCESSING'); outage = false; f.advance(660000); await f.run();
  assert.equal(f.recipients[0].status, 'UNCERTAIN'); assert.equal(f.calls.length, 1); assert.equal(f.campaign.status, 'PAUSED'); f.sentExactlyOnce();
});
test('an active owner lease prevents overlapping campaign work', async () => {
  const f = fixture(1); f.state.campaignOwnerLeases.push({ ownerId: 'local-preview-user', token: 'other', expiresAt: new Date(f.now + 60000) });
  assert.equal((await f.run()).locked, true); assert.equal(f.calls.length, 0); f.advance(60001); await f.run(); assert.equal(f.calls.length, 1);
});

test('pause/resume preserves logical batch and active preparation lease', async () => {
  const f = fixture(8); await f.run(); const batchId = f.campaign.logicalBatch.id;
  assert.equal((await f.control('pause')).status, 200); assert.equal(f.campaign.status, 'PAUSED');
  f.campaign.lockUntil = new Date(f.now + 30000);
  assert.equal((await f.control('resume')).status, 200); assert.equal(f.campaign.logicalBatch.id, batchId);
  assert.equal(+f.campaign.lockUntil, f.now + 30000); assert.equal((await f.run()).locked, true);
  f.advance(30001); await f.run(); assert.equal(f.calls.length, 8); f.sentExactlyOnce();
});
test('pause/resume between batches cannot bypass the ten-minute interval', async () => {
  const f = fixture(26); for (let i = 0; i < 5; i++) await f.run();
  const next = +f.campaign.nextRunAt; await f.control('pause'); await f.control('resume');
  assert.equal(+f.campaign.nextRunAt, next); assert.equal((await f.run()).locked, true); assert.equal(f.calls.length, 25);
});
for (const action of ['mark-sent', 'mark-failed', 'retry']) test(`manual review ${action} synchronizes message and recipient atomically`, async () => {
  const f = fixture(1); f.campaign.status = 'PAUSED';
  Object.assign(f.recipients[0], { status: 'UNCERTAIN', messageId: 1, attempts: 3, lastBatchId: 'old' });
  f.state.emailMessages.push({ id: 1, status: 'UNCERTAIN' });
  assert.equal((await f.control('resume')).status, 409);
  assert.equal((await f.review(action)).status, 200);
  assert.equal(f.recipients[0].status, action === 'mark-sent' ? 'SENT' : action === 'retry' ? 'PENDING' : 'FAILED');
  assert.equal(f.state.emailMessages[0].status, action === 'mark-sent' ? 'SENT' : 'FAILED');
  if (action === 'retry') { assert.equal(f.recipients[0].attempts, 0); assert.equal(f.recipients[0].lastBatchId, null); }
  assert.equal((await f.review(action)).status, 409); assert.equal(f.calls.length, 0);
});
test('pause after claim but before fetch is checked inside the send barrier', async () => {
  let pause = true;
  const f = fixture(2, { beforeQuery: (q, f) => { if (pause && q.kind === 'update' && q.table.table === 'emailMessages' && q.data.status === 'SENDING') { pause = false; f.campaign.status = 'PAUSED'; } } });
  await f.run(); assert.equal(f.calls.length, 0); assert.ok(f.recipients.every(r => r.status === 'PENDING')); assert.equal(f.recipients[0].attempts, 0);
});
test('READY campaign is not sent before explicit start', async () => {
  const f = fixture(1); f.campaign.status = 'READY'; assert.equal((await f.due()).length, 0); assert.equal((await f.run()).locked, true);
  await f.control('start'); await f.run(); assert.equal(f.calls.length, 1);
});
test('confirmed transient non-JSON provider response is retryable', async () => {
  const f = fixture(1, { gmail: async () => ({ ok: false, status: 502, json: async () => { throw Error('html'); } }) });
  await f.run(); assert.equal(f.recipients[0].status, 'PENDING'); assert.equal(f.recipients[0].failureCategory, 'RETRYABLE_PROVIDER_FAILURE');
});
test('unresolved Gmail delivery reserves daily quota for other campaigns', async () => {
  const f = fixture(1, { dailyLimit: 1 }); f.state.emailMessages.push({ id: 1, ownerId: 'local-preview-user', status: 'UNCERTAIN', createdAt: new Date(f.now) });
  await f.run(); assert.equal(f.calls.length, 0); assert.equal(f.recipients[0].status, 'PENDING');
});

test('lost final batch update ACK never shortens the persisted business interval', async () => {
  let fail = true;
  const f = fixture(26, { afterQuery: (q, f) => {
    if (fail && q.kind === 'update' && q.table.table === 'emailCampaigns' && q.data.logicalBatch === null && q.data.nextRunAt?.getTime?.() === f.now + 600000) {
      fail = false; throw Error('Lost update acknowledgement');
    }
  } });
  for (let i = 0; i < 5; i++) await f.run();
  assert.equal(f.calls.length, 25); assert.equal(f.campaign.logicalBatch, null); assert.equal(+f.campaign.nextRunAt, f.now + 600000);
  f.advance(60000); assert.equal((await f.run()).locked, true); assert.equal(f.calls.length, 25); f.sentExactlyOnce();
});

test('review at the end of a batch preserves the business interval before resuming', async () => {
  const f = fixture(26, { gmail: async f => { if(f.calls.length === 25) throw Error('Lost Gmail response'); return {ok:true,status:200,json:async()=>({id:'sent'})}; } });
  for(let i=0;i<5;i++) await f.run();
  assert.equal(f.campaign.status,'PAUSED'); assert.equal(+f.campaign.nextRunAt,f.now+600000);
  assert.equal((await f.review('mark-sent',25)).status,200); await f.control('resume');
  assert.equal((await f.run()).locked,true); assert.equal(f.calls.length,25);
});

test('expired Gmail authorization pauses before sending and logs the precise safe cause', async () => {
  const options = { oauthFailure: { status: 400, code: 'invalid_grant' } };
  const f = fixture(6, options), result = await f.run();
  assert.equal(result.requiresReconnect, true); assert.equal(result.errorCode, 'GMAIL_REAUTH_REQUIRED');
  assert.equal(f.campaign.status, 'PAUSED'); assert.match(f.campaign.processingNotice, /Reconecte a conta/);
  assert.equal(f.calls.length, 0); assert.ok(f.recipients.every(r => r.status === 'PENDING' && r.attempts === 0));
  const log = f.logs.find(l => l.event === 'campaign.chunk' && l.errorCode);
  assert.equal(log.stage, 'oauth-refresh'); assert.equal(log.httpStatus, 400); assert.equal(log.oauthCode, 'invalid_grant');
  assert.equal(log.category, 'AUTHENTICATION_FAILURE'); assert.equal(JSON.stringify(f.logs).includes('secret'), false);
  assert.equal((await f.run()).locked, true);
  const batchId = f.campaign.logicalBatch.id;
  assert.equal(f.state.emailAccounts[0].needsReconnect, true);
  delete options.oauthFailure; f.state.emailAccounts[0].needsReconnect = false; // Successful OAuth callback replaces authorization.
  await f.control('resume'); f.advance(60000); await f.run();
  assert.equal(f.calls.length, 5); assert.equal(f.campaign.logicalBatch.id, batchId); assert.equal(f.campaign.processingNotice, null); f.sentExactlyOnce();
});
test('temporary OAuth failure keeps recipients eligible and uses a delayed retry', async () => {
  const options = { oauthFailure: { status: 503, code: 'temporarily_unavailable' } };
  const f = fixture(1, options); const result = await f.run();
  assert.equal(f.campaign.status, 'RUNNING'); assert.equal(result.requiresReconnect, false);
  assert.equal(f.calls.length, 0); assert.equal(f.recipients[0].attempts, 0); assert.ok(+f.campaign.nextRunAt > f.now);
  delete options.oauthFailure; f.advance(60000); await f.run(); assert.equal(f.calls.length, 1);
});
test('invalid OAuth client shows a configuration notice rather than retrying forever', async () => {
  const f = fixture(1, { oauthFailure: { status: 401, code: 'invalid_client' } });
  const result = await f.run(); assert.equal(f.campaign.status, 'PAUSED'); assert.equal(result.errorCode, 'GMAIL_OAUTH_CONFIGURATION');
  assert.match(f.campaign.processingNotice, /GOOGLE_CLIENT_ID/); assert.equal(f.calls.length, 0); assert.equal(f.recipients[0].status, 'PENDING');
});
test('attachment failures are identified separately from OAuth and finalization', async () => {
  const f = fixture(1, { attachmentError: true }); await f.run();
  assert.equal(f.logs.find(l => l.event === 'campaign.chunk').stage, 'attachments'); assert.equal(f.refreshes, 0);
});

test('legacy database CHECK rejects PREPARED before Gmail and reports SQLSTATE in chunk summary',async()=>{
 const f=fixture(1,{beforeQuery(q){if(q.kind==='insert'&&q.table.table==='emailMessages'&&q.data.status==='PREPARED')throw new Error('private SQL and recipient',{cause:Object.assign(new Error('private failing row'),{code:'23514'})});}});
 const result=await f.run();
 assert.equal(result.deferred,1);assert.equal(f.calls.length,0);assert.equal(f.refreshes,1);
 assert.equal(f.recipients[0].status,'PENDING');assert.equal(f.recipients[0].attempts,0);assert.equal(f.state.emailMessages.length,0);
 assert.deepEqual(result.deferredReason,{stage:'prepare',category:'INFRASTRUCTURE_FAILURE',causeCategory:'DATABASE_FAILURE',errorCode:'23514'});
 const summary=f.logs.find(l=>l.event==='campaign.chunk'&&l.deferred===1);
 assert.deepEqual(summary.deferredReason,result.deferredReason);assert.equal(JSON.stringify(f.logs).includes('private'),false);
});
