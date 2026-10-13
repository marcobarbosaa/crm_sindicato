import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const output = resolve('outputs/smart-qa'); mkdirSync(output, { recursive: true });
const browser = spawn(process.env.CHROME_BINARY || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9338', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'crm-smart-qa-')), 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms)), pending = new Map(), errors = [], requests = [], checks = [];
let socket, seq = 0, exists = false, scenario = '', failed = false;
const imports = [];
const template = { id: 1, name: 'Documentos mensais', attachments: [{ id: 'common', name: 'informativo.pdf', mimeType: 'application/pdf', size: 200 }] };
const data = { batch: { id: 1, name: 'Documentos — demonstração', status: 'DRAFT', revision: 0, templateName: null, senderAddress: 'sender@example.test', commonAttachments: [], intervalSeconds: 60, notice: null }, items: [], summary: {},
  limits: { batchFiles: 100, fileBytes: 4194304, pages: 50 }, dailyLimit: 100, sender: 'sender@example.test' };
function summary() { const eligible = data.items.filter(i => i.reviewStatus === 'READY' && !i.excluded); data.summary = { documents: data.items.length, companies: eligible.length, eligible: eligible.length, blocked: data.items.length - eligible.length, duplicates: 0, withoutEmail: data.items.filter(i => !i.recipient).length, excluded: 0 }; }
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function waitFor(expression) { for (let n = 0; n < 180; n++) { if (await evaluate(expression).catch(() => false)) return; await delay(100); } throw Error('Timeout: ' + expression); }
async function click(text) {
  await waitFor(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});return b && !b.disabled && Object.keys(b).some(k=>k.startsWith('__reactProps'));})()`);
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw Error('Missing or disabled button ${text}');b.click()})()`); await delay(150);
}
async function screenshot(name) { await delay(400); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(output, name + '.png'), Buffer.from(r.data, 'base64')); }
async function mock({ requestId, request }) {
  const path = new URL(request.url).pathname; requests.push({ path, method: request.method }); let body = [], status = 200;
  if (path === '/api/dashboard') body = { total: 0, activities: [] };
  else if (path === '/api/smart-sends') { if (request.method === 'POST') { exists = true; data.items = []; imports.length = 0; data.batch.status = 'DRAFT'; body = { id: 1 }; } else body = exists ? [data.batch] : []; }
  else if (path === '/api/smart-sends/templates') body = [template];
  else if (path === '/api/smart-sends/companies') body = [{ id: 2, name: 'Empresa Beta', primaryEmail: 'beta@example.test', cnpj: '11444777000161' }];
  else if (path.endsWith('/upload')) {
    const header = name => Object.entries(request.headers).find(([key]) => key.toLowerCase() === name)?.[1];
    const fileName = decodeURIComponent(header('x-file-name'));
    if (scenario === 'pause' && fileName === 'volume-1.pdf') await delay(1500);
    if (scenario === 'reload' && fileName === 'volume-26.pdf' && !failed) {
      failed = true; status = 503; body = { code: 'SERVICE_UNAVAILABLE', error: 'Worker indisponível.' };
      await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }); return;
    }
    const first = data.items.length === 0;
    const item = { id: header('x-upload-id'), fileName, fileSize: 2100, fileReady: true, fileDeletedAt: null, readable: true,
      companyId: first ? 1 : null, companyName: first ? 'Empresa Alfa' : null, recipient: first ? 'alfa@example.test' : null, companyCnpj: null,
      extractedCnpjs: first ? ['11222333000181'] : [], candidates: first ? [1] : [2], suggestions: first ? [] : [{ id: 2, name: 'Empresa Beta', primaryEmail: 'beta@example.test' }], identificationMethod: first ? 'CNPJ' : 'FILENAME',
      reviewStatus: first ? 'IDENTIFIED' : 'REVIEW_REQUIRED', sendStatus: 'DRAFT', deliveryStatus: 'PENDING', excluded: false, error: null };
    body = { ok: true, documentId: header('x-upload-id'), contentHash: createHash('sha256').update('%PDF-synthetic-' + fileName).digest('hex'), persistence: 'persisted', storage: 'stored', analysis: 'complete', code: null, message: 'PDF salvo e analisado.', recoverable: false };
    if (scenario === 'mixed' && fileName === 'volume-1.pdf' && !header('x-recover-upload')) {
      Object.assign(body, { analysis: 'pending', recoverable: true, code: 'IMPORT_ANALYSIS_FAILED', message: 'PDF salvo. Análise pendente de recuperação.' });
      Object.assign(item, { readable: false, reviewStatus: 'READ_ERROR', error: 'IMPORT_ANALYSIS_FAILED' });
    }
    if (scenario === 'mixed' && fileName === 'volume-2.pdf') {
      Object.assign(body, { analysis: 'failed', code: 'PDF_CORRUPT', message: 'PDF salvo, mas a leitura falhou. Revise o documento.' });
      Object.assign(item, { readable: false, reviewStatus: 'READ_ERROR', error: 'PDF_CORRUPT' });
    }
    const priorItem = data.items.findIndex(row => row.id === item.id), priorResult = imports.findIndex(row => row.documentId === item.id);
    if (priorItem >= 0) data.items.splice(priorItem, 1);
    if (priorResult >= 0) imports.splice(priorResult, 1);
    data.items.push(item);
    imports.push(body);
  } else if (path.endsWith('/import-status')) {
    body = { batchId: 1, items: imports };
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
  } else if (path === '/api/smart-sends/1') { summary(); body = data; if (scenario === 'refresh' && imports.length === 100) { status = 503; body = { code: 'SERVICE_UNAVAILABLE', error: 'Falha na atualização.' }; } }
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
  await send('Page.navigate', { url: process.env.SMART_UI_TEST_URL || 'http://localhost:5174/workspace' });
  await waitFor("[...document.querySelectorAll('nav button')].some(b=>b.textContent.trim()==='Envios Inteligentes')"); await click('Envios Inteligentes');
  await waitFor("document.querySelector('.smart-empty') && ![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Novo lote').disabled"); await click('Novo lote');
  await waitFor("!!document.querySelector('#smart-files')");
  await evaluate(`(()=>{const dt=new DataTransfer();for(const name of ['alfa.pdf','beta.pdf'])dt.items.add(new File(['%PDF-synthetic-'+name],name,{type:'application/pdf'}));const el=document.querySelector('#smart-files');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor("document.querySelectorAll('.smart-upload-list li.complete').length===2 && !document.querySelector('#smart-files').disabled");
  assert.equal(await evaluate("!!document.querySelector('.smart-sends table') || document.querySelector('.smart-sends').textContent.includes('Mensagem e confirmação')"), false);
  assert.equal(await evaluate("document.querySelector('.smart-steps [aria-current=step]').textContent"), '1Importação');
  await screenshot('desktop-import-complete');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await screenshot('mobile-import-complete');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  checks.push('import isolated from identification and message, desktop/mobile screenshots, correct active step');
  assert.equal(requests.filter(r => r.path.endsWith('/control')).length, 0); checks.push('multiple upload, progress and no automatic sending');
  await click('Continuar para identificação');
  await waitFor("document.querySelectorAll('.smart-sends tbody tr').length===2");
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
  const selectVolume = async count => evaluate(`(()=>{const dt=new DataTransfer();for(let n=1;n<=${count};n++){const name='volume-'+n+'.pdf';dt.items.add(new File(['%PDF-synthetic-'+name],name,{type:'application/pdf'}));}const el=document.querySelector('#smart-files');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  for (const count of [1, 10, 26, 30, 50, 100]) {
    scenario = count === 100 ? 'refresh' : ''; await click('Novo lote');
    await waitFor("!!document.querySelector('#smart-files') && !document.querySelector('#smart-files').disabled");
    const before = requests.filter(r => r.path.endsWith('/upload')).length;
    await selectVolume(count);
    await waitFor(`document.querySelectorAll('.smart-upload-list li').length===${Math.min(count, 25)} && !document.querySelector('#smart-files').disabled`);
    assert.equal(requests.filter(r => r.path.endsWith('/upload')).length - before, count);
    assert.equal(await evaluate("[...document.querySelectorAll('.smart-import-file-state small')].every(e=>e.textContent.includes('salvo e analisado'))"), true);
    assert.equal(await evaluate("Number(document.querySelector('[data-count=Concluídos] dd').textContent)"), count);
    if (count === 100) assert.equal(await evaluate("document.querySelector('[role=alert]')?.textContent.includes('atualizar a tela')"), true);
    if (count === 100) {
      scenario = ''; await click('Tentar novamente');
      await click('Próxima'); assert.equal(await evaluate("document.querySelector('.smart-import-filename strong').textContent"), 'volume-26.pdf');
      await screenshot('mobile-import-100');
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await screenshot('desktop-import-100');
      checks.push('100 documents use 25 visible rows, counts cover all pages, navigation reaches document 26');
    }
    checks.push(`${count} PDFs in browser, confirmed individually`);
  }
  scenario = 'reload'; await click('Novo lote'); await selectVolume(30);
  await waitFor("document.querySelectorAll('.smart-upload-list li').length===25 && !document.querySelector('#smart-files').disabled");
  assert.equal(imports.length, 25);
  const uploadAttempts = requests.filter(r => r.path.endsWith('/upload')).length;
  await evaluate("(()=>{const dt=new DataTransfer();dt.items.add(new File(['%PDF-synthetic-volume-26.pdf'],'renomeado.pdf',{type:'application/pdf'}));const el=document.querySelector('#smart-files');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("!document.querySelector('#smart-files').disabled && document.querySelector('[data-count=Concluídos] dd').textContent==='29'");
  assert.equal(requests.filter(r => r.path.endsWith('/upload')).length - uploadAttempts, 4);
  assert.equal(await evaluate("document.querySelector('[data-count=Selecionados] dd').textContent"), '30');
  checks.push('renaming an uncertain PDF does not create a new queue entry or retry it');
  await send('Page.reload');
  await waitFor("[...document.querySelectorAll('nav button')].some(b=>b.textContent.trim()==='Envios Inteligentes')"); await click('Envios Inteligentes');
  await waitFor("[...document.querySelectorAll('.smart-sends select option')].some(o=>o.value==='1')");
  await evaluate("(()=>{const s=document.querySelector('.smart-sends select');s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("document.querySelectorAll('.smart-upload-list li').length===25 && !document.querySelector('#smart-files').disabled");
  await click('Tentar novamente falhas recuperáveis'); assert.equal(imports.length, 29);
  await selectVolume(30);
  await waitFor("!document.querySelector('#smart-files').disabled");
  assert.equal(imports.length, 29); // Reselection alone must not retry the uncertain request.
  await click('Tentar novamente falhas recuperáveis');
  await waitFor("!document.querySelector('#smart-files').disabled && document.querySelector('[data-count=Concluídos] dd').textContent==='30'");
  assert.equal(imports.length, 30); assert.equal(new Set(imports.map(r => r.documentId)).size, 30);
  checks.push('503 on document 26, preserved queue, browser reload, reconcile and reselect without duplicate records');
  const controlsBefore = requests.filter(r => r.path.endsWith('/control')).length;
  scenario = 'pause'; await click('Novo lote');
  await screenshot('desktop-import-empty');
  await selectVolume(4);
  await waitFor("document.querySelectorAll('.smart-import-file.processing').length===1");
  await click('Pausar novos uploads');
  await waitFor("!document.querySelector('#smart-files').disabled");
  assert.equal(imports.length, 1);
  assert.equal(await evaluate("document.querySelector('[data-count=Aguardando] dd').textContent"), '3');
  await screenshot('desktop-import-paused');
  await evaluate("document.querySelector('[aria-label=\"Remover volume-4.pdf da fila\"]').click()");
  await waitFor("document.querySelectorAll('.smart-upload-list li').length===3");
  await click('Continuar importação');
  await waitFor("!document.querySelector('#smart-files').disabled && document.querySelector('[data-count=Concluídos] dd').textContent==='3'");
  assert.equal(imports.length, 3);
  await selectVolume(4); await waitFor("!document.querySelector('#smart-files').disabled && document.querySelector('[data-count=Concluídos] dd').textContent==='4'");
  assert.equal(imports.length, 4); checks.push('pause finishes active request, queued file removal, safe resume, add more files without duplicates');

  scenario = 'mixed'; await click('Novo lote'); await selectVolume(3);
  await waitFor("!document.querySelector('#smart-files').disabled && document.querySelector('[data-count=Concluídos] dd').textContent==='1'");
  assert.equal(await evaluate("document.querySelector('[data-count=\"Com falha\"] dd').textContent"), '2');
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continuar para identificação').disabled"), true);
  await screenshot('desktop-import-errors');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await screenshot('mobile-import-errors');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await click('Tentar novamente falhas recuperáveis');
  await waitFor("!document.querySelector('#smart-files').disabled && document.querySelector('[data-count=Concluídos] dd').textContent==='2'");
  assert.equal(imports.length, 3);
  await evaluate("(()=>{const select=document.querySelector('.smart-import-documents select');select.value='failed';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("document.querySelectorAll('.smart-upload-list li').length===1");
  assert.equal(await evaluate("document.querySelector('.smart-import-filename strong').textContent"), 'volume-2.pdf');
  await evaluate("document.querySelector('.smart-import-omitted input').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await click('Continuar para identificação');
  assert.equal(await evaluate("document.activeElement.id"), 'smart-batch-heading');
  await click('Voltar à importação'); await waitFor("!!document.querySelector('#smart-files')");
  assert.equal(await evaluate("document.querySelector('[data-count=Concluídos] dd').textContent"), '2');
  checks.push('recoverable and permanent individual failures, retry same record, filter, keyboard acknowledgement, partial advance and return');

  scenario = ''; await click('Novo lote');
  // The mock reuses ID 1; a real newly created batch has a fresh storage key.
  await evaluate("localStorage.removeItem('smart-import:v1:1')");
  data.limits = { ...data.limits, batchFiles: 7, fileBytes: 2097152, pages: 12 };
  await click('Voltar aos lotes');
  await evaluate("(()=>{const s=document.querySelector('.smart-sends select');s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("document.querySelector('#smart-import-limits')?.textContent.includes('7 documentos')");
  assert.equal(await evaluate("document.querySelector('#smart-import-limits').textContent.includes('2 MB') && document.querySelector('#smart-import-limits').textContent.includes('12 páginas')"), true);
  checks.push('document, byte and page limits reflect backend configuration');
  await evaluate("(()=>{const dt=new DataTransfer();dt.items.add(new File(['bad'],'nao-pdf.txt',{type:'text/plain'}));const el=document.querySelector('#smart-files');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("!!document.querySelector('.smart-import-file.failed') && !document.querySelector('#smart-files').disabled");
  assert.equal(imports.length, 0);
  await evaluate("document.querySelector('[aria-label=\"Remover nao-pdf.txt da fila\"]').click()");
  await waitFor("document.querySelectorAll('.smart-upload-list li').length===0");
  await evaluate("(()=>{const dt=new DataTransfer();const name='solto.pdf';dt.items.add(new File(['%PDF-synthetic-'+name],name,{type:'application/pdf'}));document.querySelector('.smart-drop').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));})()");
  await waitFor("document.querySelector('[data-count=Concluídos] dd')?.textContent==='1' && !document.querySelector('#smart-files').disabled");
  assert.equal(imports.length, 1); checks.push('drag and drop starts import using the same validation and queue');
  await evaluate("localStorage.removeItem('smart-import:v1:1')");
  await click('Voltar aos lotes');
  await evaluate("(()=>{const s=document.querySelector('.smart-sends select');s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("document.querySelector('[data-count=Concluídos] dd')?.textContent==='1' && !document.querySelector('#smart-files').disabled");
  checks.push('reopened batch displays server documents even without browser queue metadata');
  assert.equal(requests.filter(r => r.path.endsWith('/control')).length, controlsBefore);
  checks.push('invalid file visible and removable, import actions never invoke sending');
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'report.json'), JSON.stringify({ checks, requests, errors }, null, 2)); console.log(`Smart UI: ${checks.length} checks passed. ${output}`);
} catch (error) { if (socket?.readyState === 1) { await screenshot('failure').catch(() => {}); console.error(await evaluate('document.body.innerText').catch(() => ''), errors); } throw error; }
finally { if (socket?.readyState === 1) { await send('Browser.close').catch(() => {}); socket.close(); } browser.kill(); }
