import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const output = resolve('outputs/smart-batch-qa'); mkdirSync(output, { recursive: true });
const browser = spawn(process.env.CHROME_BINARY || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9339', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'crm-smart-qa-')), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms)), pending = new Map(), errors = [], requests = [], checks = [];
let socket, seq = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function waitFor(expression) { for (let n = 0; n < 180; n++) { if (await evaluate(expression).catch(() => false)) return; await delay(100); } throw Error('Timeout: ' + expression); }
async function click(text) {
  await waitFor(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});return b && !b.disabled && Object.keys(b).some(k=>k.startsWith('__reactProps'));})()`);
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing or disabled button ${text}');b.click()})()`); await delay(150);
}
async function screenshot(name) { await delay(400); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(output, name + '.png'), Buffer.from(r.data, 'base64')); }
const batches = [
  { id: 1, name: 'Rascunho de teste', status: 'DRAFT', documents: 2, pendingReview: 2, sent: 0 },
  { id: 2, name: 'Histórico preservado', status: 'COMPLETED', documents: 1, pendingReview: 0, sent: 1 },
  { id: 3, name: 'Preparado nunca iniciado', status: 'READY', documents: 3, pendingReview: 0, sent: 0 },
].map(row => ({ ...row, createdAt: '2026-10-13T12:00:00Z', deletionRequestedAt: null, deletionError: null, pendingFiles: row.documents }));
async function mock({ requestId, request }) {
  const url = new URL(request.url), path = url.pathname;
  requests.push({ path, method: request.method, query: url.search });
  let body = [];
  if (path === '/api/dashboard') body = { total: 0, activities: [] };
  else if (path === '/api/smart-sends/batches') {
    let rows = batches.filter(row => !row.deleted && row.name.toLowerCase().includes((url.searchParams.get('search') || '').toLowerCase()));
    if (url.searchParams.get('status')) rows = rows.filter(row => row.status === url.searchParams.get('status'));
    body = { rows, hasMore: false };
  } else if (path === '/api/smart-sends/deletion-preview') {
    body = JSON.parse(request.postData).ids.map(id => {
      const row = batches.find(row => row.id === id), eligible = row.status !== 'COMPLETED';
      return { ...row, revision: 0, eligible, state: eligible ? 'eligible' : 'blocked', reason: eligible ? null : 'Histórico de envio preservado.' };
    });
  } else if (path === '/api/smart-sends/deletion-request') {
    const input = JSON.parse(request.postData);
    assert.equal(input.confirmed, true);
    assert.ok(input.batches.every(row => row.id !== 2), 'Blocked batch must never be included');
    body = input.batches.map(choice => {
      const row = batches.find(row => row.id === choice.id); row.deletionRequestedAt = new Date().toISOString();
      return { ...row, revision: 0, eligible: false, state: 'pending', reason: null };
    });
  }
  await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
}
try {
  let targets; for (let n = 0; n < 100; n++) { try { targets = await (await fetch('http://127.0.0.1:9339/json/list')).json(); break; } catch { await delay(100); } }
  if (!targets) throw Error('Browser unavailable');
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
  socket.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p?.reject(Error(JSON.stringify(m.error))); else p?.resolve(m.result); }
    else if (m.method === 'Fetch.requestPaused') void mock(m.params).catch(e => errors.push(String(e))); else if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails)); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: process.env.SMART_UI_TEST_URL || 'http://localhost:5176/workspace' });
  await waitFor("[...document.querySelectorAll('nav button')].some(b=>b.textContent.trim()==='Envios Inteligentes')"); await click('Envios Inteligentes');
  await waitFor("document.querySelectorAll('.smart-batch-list > li').length===3");
  await screenshot('desktop-list');
  await evaluate("localStorage.setItem('smart-import:v1:1','[]');localStorage.setItem('smart-import:v1:2','[]');localStorage.setItem('smart-import:v1:3','[]');");
  await evaluate("document.querySelector('.smart-batch-actions details').open=true"); await click('Excluir lote');
  await waitFor("!!document.querySelector('[role=alertdialog]')");
  assert.equal(requests.filter(r => r.path.endsWith('deletion-request')).length, 0);
  await click('Cancelar'); await waitFor("!document.querySelector('[role=alertdialog]')");
  checks.push('individual deletion previews first; cancelling does not delete');
  await evaluate("document.querySelectorAll('.smart-batch-list input[type=checkbox]').forEach(el=>el.click())");
  await click('Excluir selecionados');
  await waitFor("document.querySelector('[role=alertdialog]')?.textContent.includes('2 elegível(is)')");
  assert.match(await evaluate("document.querySelector('[role=alertdialog]').textContent"), /1 bloqueado.*5 PDFs/);
  await screenshot('desktop-confirmation');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot('mobile-confirmation');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await click('Excluir definitivamente');
  await waitFor("!document.querySelector('[role=alertdialog]') && document.querySelector('.smart-batch-list').textContent.includes('Em exclusão')");
  assert.equal(requests.filter(r => r.path.endsWith('deletion-request')).length, 1);
  assert.equal(await evaluate("localStorage.getItem('smart-import:v1:1')"), null);
  assert.equal(await evaluate("localStorage.getItem('smart-import:v1:3')"), null);
  assert.equal(await evaluate("localStorage.getItem('smart-import:v1:2')"), '[]');
  checks.push('bulk confirmation includes only eligible IDs and clears only their queues');
  await screenshot('mobile-pending');
  batches.find(row => row.id === 1).deleted = true; batches.find(row => row.id === 3).deleted = true;
  await click('Atualizar'); await waitFor("document.querySelectorAll('.smart-batch-list > li').length===1");
  assert.match(await evaluate("document.querySelector('.smart-batch-list').textContent"), /Histórico preservado/);
  checks.push('completed deletion refresh removes only deleted batches');
  await send('Page.reload');
  await waitFor("[...document.querySelectorAll('nav button')].some(b=>b.textContent.trim()==='Envios Inteligentes')"); await click('Envios Inteligentes');
  await waitFor("document.querySelectorAll('.smart-batch-list > li').length===1");
  await evaluate("(()=>{const el=document.querySelector('.smart-batch-filters input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'ausente');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await waitFor("document.querySelector('.smart-empty')?.textContent.includes('Nenhum lote encontrado')");
  checks.push('reload preserves deletion and search updates empty state');
  assert.deepEqual(errors, []);
  assert.equal(requests.some(r => r.path.endsWith('/control') || r.path.endsWith('/upload')), false);
  writeFileSync(join(output, 'report.json'), JSON.stringify({ checks, requests, errors }, null, 2));
  console.log(`Batch UI: ${checks.length} checks passed. ${output}`);
} catch (error) {
  if (socket?.readyState === 1) { await screenshot('failure').catch(() => {}); console.error(await evaluate('document.body.innerText').catch(() => ''), errors); }
  throw error;
} finally {
  if (socket?.readyState === 1) { await send('Browser.close').catch(() => {}); socket.close(); }
  browser.kill();
}
