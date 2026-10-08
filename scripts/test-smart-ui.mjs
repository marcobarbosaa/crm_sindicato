import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const output = resolve('outputs/smart-qa'); mkdirSync(output, { recursive: true });
const browser = spawn(process.env.CHROME_BINARY || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9338', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'crm-smart-qa-')), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms)), pending = new Map(), errors = [], requests = [], checks = [];
let socket, seq = 0, exists = false;
const template = { id: 1, name: 'Documentos mensais', attachments: [{ id: 'common', name: 'informativo.pdf', mimeType: 'application/pdf', size: 200 }] };
const data = { batch: { id: 1, name: 'Documentos — demonstração', status: 'DRAFT', revision: 0, templateName: null, senderAddress: 'sender@example.test', commonAttachments: [], intervalSeconds: 60, notice: null }, items: [], summary: {},
  limits: { batchFiles: 100, fileBytes: 4194304, pages: 50 }, dailyLimit: 100, sender: 'sender@example.test' };
function summary() { const eligible = data.items.filter(i => i.reviewStatus === 'READY' && !i.excluded); data.summary = { documents: data.items.length, companies: eligible.length, eligible: eligible.length, blocked: data.items.length - eligible.length, duplicates: 0, withoutEmail: data.items.filter(i => !i.recipient).length, excluded: 0 }; }
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function waitFor(expression) { for (let n = 0; n < 180; n++) { if (await evaluate(expression).catch(() => false)) return; await delay(100); } throw Error('Timeout: ' + expression); }
async function click(text) { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing or disabled button ${text}');b.click()})()`); await delay(150); }
async function screenshot(name) { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(output, name + '.png'), Buffer.from(r.data, 'base64')); }
async function mock({ requestId, request }) {
  const path = new URL(request.url).pathname; requests.push({ path, method: request.method }); let body = [], status = 200;
  if (path === '/api/dashboard') body = { total: 0, activities: [] };
  else if (path === '/api/smart-sends') { if (request.method === 'POST') { exists = true; body = { id: 1 }; } else body = exists ? [data.batch] : []; }
  else if (path === '/api/smart-sends/templates') body = [template];
  else if (path === '/api/smart-sends/companies') body = [{ id: 2, name: 'Empresa Beta', primaryEmail: 'beta@example.test', cnpj: '11444777000161' }];
  else if (path.endsWith('/upload')) {
    const first = data.items.length === 0;
    data.items.push({ id: first ? 'item-1' : 'item-2', fileName: first ? 'documento-alfa.pdf' : 'documento-beta.pdf', fileSize: 2100, fileReady: true, readable: true,
      companyId: first ? 1 : null, companyName: first ? 'Empresa Alfa' : null, recipient: first ? 'alfa@example.test' : null, companyCnpj: null,
      extractedCnpjs: first ? ['11222333000181'] : [], candidates: first ? [1] : [2], suggestions: first ? [] : [{ id: 2, name: 'Empresa Beta', primaryEmail: 'beta@example.test' }], identificationMethod: first ? 'CNPJ' : 'FILENAME',
      reviewStatus: first ? 'IDENTIFIED' : 'REVIEW_REQUIRED', sendStatus: 'DRAFT', deliveryStatus: 'PENDING', excluded: false });
    body = { ok: true };
  } else if (path.includes('/items/') && request.method === 'PATCH') {
    const item = data.items.find(i => path.endsWith(i.id)), input = JSON.parse(request.postData);
    if (input.companyId) Object.assign(item, { companyId: 2, companyName: 'Empresa Beta', recipient: 'beta@example.test', reviewStatus: 'IDENTIFIED', identificationMethod: 'MANUAL' });
    if (input.confirm) item.reviewStatus = 'READY';
    data.batch.revision++; data.batch.status = 'DRAFT'; body = { ok: true };
  } else if (path.endsWith('/prepare')) {
    const input = JSON.parse(request.postData); data.batch.status = 'READY'; data.batch.templateName = template.name; data.batch.revision++;
    data.batch.commonAttachments = input.includeCommon ? template.attachments : [];
    for (const item of data.items) { item.subject = 'Documento para ' + item.companyName; item.body = 'Olá, segue seu documento.\n\nAssinatura CRM'; }
    summary(); body = data;
  } else if (path.endsWith('/control')) {
    const input = JSON.parse(request.postData); assert.equal(input.confirmed, true); assert.equal(input.revision, data.batch.revision); data.batch.status = 'RUNNING'; data.items.forEach(i => { i.sendStatus = 'PENDING'; }); summary(); body = data;
  } else if (path === '/api/smart-sends/1') { summary(); body = data; }
  await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
}
try {
  let targets; for (let n = 0; n < 100; n++) { try { targets = await (await fetch('http://127.0.0.1:9338/json/list')).json(); break; } catch { await delay(100); } }
  if (!targets) throw Error('Browser unavailable');
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
  socket.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p?.reject(Error(JSON.stringify(m.error))); else p?.resolve(m.result); }
    else if (m.method === 'Fetch.requestPaused') void mock(m.params).catch(e => errors.push(String(e))); else if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails)); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: process.env.SMART_UI_TEST_URL || 'http://localhost:5174' });
  await waitFor("[...document.querySelectorAll('nav button')].some(b=>b.textContent.trim()==='Envios Inteligentes')"); await click('Envios Inteligentes');
  await waitFor("document.querySelector('.smart-empty') && ![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Novo lote').disabled"); await click('Novo lote');
  await waitFor("!!document.querySelector('#smart-files')");
  await evaluate(`(()=>{const dt=new DataTransfer();for(const name of ['alfa.pdf','beta.pdf'])dt.items.add(new File(['%PDF-synthetic'],name,{type:'application/pdf'}));const el=document.querySelector('#smart-files');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor("document.querySelectorAll('.smart-sends tbody tr').length===2 && !document.querySelector('#smart-files').disabled");
  assert.equal(requests.filter(r => r.path.endsWith('/control')).length, 0); checks.push('multiple upload, progress and no automatic sending');
  await click('Confirmar associação'); await waitFor("document.querySelector('.smart-sends tbody tr').textContent.includes('Pronto para envio')");
  await evaluate("document.querySelectorAll('.smart-associate')[1].open=true"); await click('Empresa Betabeta@example.test');
  await waitFor("document.querySelectorAll('.smart-sends tbody tr')[1].textContent.includes('beta@example.test')"); await click('Confirmar associação');
  await waitFor("document.querySelectorAll('.smart-status.ok').length===2"); await screenshot('desktop-review'); checks.push('manual association and individual confirmation');
  await evaluate("(()=>{const s=[...document.querySelectorAll('.smart-sends select')].find(s=>s.textContent.includes('Selecione um template'));s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await click('Gerar revisão final'); await waitFor("!!document.querySelector('.smart-final')");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Confirmar e iniciar')).disabled"), true);
  assert.equal(data.batch.commonAttachments.length, 0); checks.push('common attachments opt-in, preview with signature and explicit final confirmation'); await screenshot('desktop-confirmation');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await delay(200); await screenshot('mobile-confirmation');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true); checks.push('mobile without page overflow');
  await evaluate("document.querySelector('.smart-final input[type=checkbox]').click()"); await click('Confirmar e iniciar 2 envios');
  await waitFor("document.querySelector('.smart-actions')?.textContent.includes('Pausar')");
  assert.equal(requests.filter(r => r.path.endsWith('/control')).length, 1); assert.equal(await evaluate("document.querySelector('.smart-sends').textContent.includes('não comprova entrega')"), true);
  checks.push('monitor and accurate Gmail acceptance wording'); await screenshot('mobile-monitor'); assert.deepEqual(errors, []);
  writeFileSync(join(output, 'report.json'), JSON.stringify({ checks, requests, errors }, null, 2)); console.log(`Smart UI: ${checks.length} checks passed. ${output}`);
} catch (error) { if (socket?.readyState === 1) { await screenshot('failure').catch(() => {}); console.error(await evaluate('document.body.innerText').catch(() => ''), errors); } throw error; }
finally { if (socket?.readyState === 1) { await send('Browser.close').catch(() => {}); socket.close(); } browser.kill(); }
