import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function loadWorker({ fetch, cleanup }) {
  const logs = [];
  const loadedModule = { exports: {} };
  const require = name => {
    if (name === "vinext/server/fetch-handler") return { fetch };
    if (name === "./lib/attachment-service") return { cleanupAttachments: cleanup };
    throw new Error("Unexpected dependency: " + name);
  };
  const logger = Object.fromEntries(["info", "error"].map(level => [level, value => logs.push({ level, ...value })]));
  new Function("require", "module", "exports", "console", compiled)(require, loadedModule, loadedModule.exports, logger);
  return { worker: loadedModule.exports.default, logs };
}
const event = { cron: "*/5 * * * *", scheduledTime: 1_800_000_000_000 };

test("HTTP delegates request, env and context unchanged to Vinext", async () => {
  const request = new Request("https://example.test/workspace"), env = {}, ctx = {};
  const response = new Response("Next.js");
  const { worker } = loadWorker({
    fetch: (...args) => { assert.deepEqual(args, [request, env, ctx]); return response; },
    cleanup: () => assert.fail("HTTP must not run cleanup"),
  });
  assert.equal(await worker.fetch(request, env, ctx), response);
});

test("scheduled awaits the existing cleanup directly and reports counts", async () => {
  let release, calls = 0, finished = false;
  const { worker, logs } = loadWorker({
    fetch: () => assert.fail("Cron must not call HTTP"),
    cleanup: () => { calls++; return new Promise(resolve => { release = resolve; }); },
  });
  const execution = worker.scheduled(event).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(calls, 1); assert.equal(finished, false);
  release({ deleted: 3, pending: 0 });
  await execution;
  assert.equal(logs.at(-1).status, "completed");
  assert.equal(logs.at(-1).deleted, 3);
  assert.equal(logs.at(-1).scheduledTime, event.scheduledTime);
});

test("provider failures fail the event without leaking provider details", async () => {
  const secret = "postgres://private-password@private-host/db";
  const { worker, logs } = loadWorker({ cleanup: async () => { throw new Error(secret); } });
  await assert.rejects(worker.scheduled(event), error => {
    assert.equal(error.message.includes(secret), false);
    return /cleanup failed/.test(error.message);
  });
  assert.equal(logs.at(-1).status, "failed");
  assert.equal(JSON.stringify(logs).includes(secret), false);
});

test("partial cleanup is visible as a failed scheduled event and is not retried in a loop", async () => {
  let calls = 0;
  const { worker, logs } = loadWorker({ cleanup: async () => { calls++; return { deleted: 2, pending: 1 }; } });
  await assert.rejects(worker.scheduled(event), /cleanup incomplete/);
  assert.equal(calls, 1); assert.equal(logs.at(-1).status, "partial");
  assert.equal(logs.at(-1).pending, 1);
});
