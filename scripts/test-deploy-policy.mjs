import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDeployConfig } from './deploy-policy.mjs';
import { loader } from './smart-test-loader.mjs';
const { WORKER_CRONS } = loader()('lib/worker-schedule.ts');
const valid = () => ({ triggers: { crons: [...WORKER_CRONS] }, keep_vars: true, vars: {} });
test('production config reserves only three trigger slots and preserves remote vars', () => assert.doesNotThrow(() => validateDeployConfig(valid())));
test('rejects excess/missing/duplicate triggers before deploy', () => {
 for(const crons of [[],[...WORKER_CRONS,...WORKER_CRONS],['* * * * *','* * * * *','*/2 * * * *']])assert.throws(()=>validateDeployConfig({...valid(),triggers:{crons}}));
});
test('rejects unsafe vars policy without printing a sensitive value', () => {
 for(const config of [{...valid(),keep_vars:false},{...valid(),vars:{DATABASE_URL:'synthetic-secret'}},{...valid(),vars:{SMART_SEND_BUCKET:'local'}}]){
  assert.throws(()=>validateDeployConfig(config),e=>!e.message.includes('synthetic-secret') && /bindings remotos/.test(e.message));
 }
});
test('deploy command validates artifact and uses keep-vars without uploading secrets', () => {
 const source=readFileSync('scripts/deploy.mjs','utf8');
 assert.ok(source.indexOf('validateDeployConfig(JSON.parse')<source.indexOf('"--keep-vars"'));
 assert.ok(source.includes('"--keep-vars"'));assert.doesNotMatch(source,/--secrets-file|secret\s+bulk/);
});
