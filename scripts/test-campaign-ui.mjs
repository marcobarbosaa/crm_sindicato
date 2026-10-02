import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const baseUrl = process.env.CAMPAIGN_TEST_URL || "http://localhost:5173";
const output = resolve("outputs/campaign-qa"); mkdirSync(output, { recursive: true });
const browser = spawn(process.env.CHROME_BINARY || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=9336", "--user-data-dir=" + mkdtempSync(join(tmpdir(), "crm-campaign-qa-")), "about:blank",
], { windowsHide: true, stdio: "ignore" });
const delay = ms => new Promise(r => setTimeout(r, ms));
let socket, seq = 0, failMonitor = false, holdProcessing = false;
const pending = new Map(), errors = [], requests = [], checks = [], loadWaiters = [];
const iso = offset => new Date(Date.now() + offset).toISOString();
const fixture = () => ({ id: 42, name: "Relacionamento com empresas — Região 8", status: "RUNNING", total: 137, sent: 45, failed: 3, skipped: 9, pending: 80, batchSize: 25, intervalMinutes: 10, startedAt: iso(-7200000), nextRunAt: iso(462000), lockUntil: null, completedAt: null });
let campaign = fixture();
let monitoring = { remainingToday: 43, dailySendLimit: 100, nextDailyWindow: iso(36000000), timezone: "America/Sao_Paulo", queued: 80, processing: 0, uncertain: 0, activities: [
  { id: 1, companyName: "Empresa exemplo", recipient: "contato@example.com", status: "SENT", errorMessage: null, updatedAt: iso(-120000) },
  { id: 2, companyName: "Empresa com falha", recipient: "teste@example.com", status: "FAILED", errorMessage: "Falha registrada no envio.", updatedAt: iso(-180000) },
] };
let reviews = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 240; i++) { if (await evaluate(expression).catch(() => false)) return; await delay(100); }
  throw Error("Timeout: " + expression);
}
async function click(text, selector = "button") {
  await evaluate(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error("Missing button");if(el.disabled)throw Error("Button disabled: "+el.textContent);el.click()})()`);
  await delay(120);
}
async function screenshot(name) {
  const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(resolve(output, name + ".png"), Buffer.from(result.data, "base64"));
}
async function openMonitor() {
  const loaded = new Promise(resolve => loadWaiters.push(resolve));
  await send("Page.navigate", { url: baseUrl + "/workspace" });
  await loaded;
  await waitFor("document.querySelector('.sidebar-help')?.getAttribute('role') === 'button'");
  await waitFor("[...document.querySelectorAll('nav button')].some(e=>e.textContent.trim()==='Envio em lote')");
  await click("Envio em lote", "nav button");
  await waitFor("!!document.querySelector('.campaign-monitor .cm-quota') || !!document.querySelector('.campaign-monitor .cm-activity li')");
  await delay(200);
}
async function mock({ requestId, request }) {
  const path = new URL(request.url).pathname;
  requests.push({ path, method: request.method, at: Date.now() });
  let data = [], status = 200;
  if (path === "/api/email-campaigns") data = [{ ...campaign, status: ["COMPLETED", "CANCELLED"].includes(campaign.status) ? "RUNNING" : campaign.status }];
  else if (path.endsWith("/monitor")) { if (failMonitor) { status = 503; data = { error: "Falha simulada" }; } else data = { campaign, monitoring }; }
  else if (path.endsWith("/delivery")) {
    const category = new URL(request.url).searchParams.get("category");
    data = { items: category && category !== "ADDRESS_NOT_FOUND" ? [] : [{ id: 1, companyName: "Empresa devolvida", recipient: "antigo@example.test", deliveryStatus: "BOUNCED", category: "ADDRESS_NOT_FOUND", smtpStatus: "5.1.1", diagnostic: "<img src=x onerror=alert(1)> user unknown", bouncedAt: iso(-60000) }], nextCursor: null, summary: { sent: 45, addressNotFound: 1, noKnownFailure: 44 }, enabled: true, needsReconnect: false, syncError: null, checkedAt: iso(0), completedAt: null };
  }
  else if (path.endsWith("/review/recipients")) data = { recipients: reviews, campaignStatus: campaign.status };
  else if (path.endsWith("/review")) {
    const { recipientId, action } = JSON.parse(request.postData);
    reviews = reviews.filter(r => r.id !== recipientId); monitoring.uncertain = reviews.length;
    if (action === "mark-sent") campaign.sent++;
    if (action === "mark-failed") campaign.failed++;
    data = { ok: true };
  } else if (path.endsWith("/control")) {
    const { action } = JSON.parse(request.postData);
    campaign = { ...campaign, status: { start: "RUNNING", resume: "RUNNING", pause: "PAUSED", cancel: "CANCELLED" }[action], nextRunAt: ["start", "resume"].includes(action) ? iso(600000) : null };
    data = campaign;
  } else if (path.endsWith("/process")) {
    if (holdProcessing) { await delay(1200); data = { locked: true }; }
    else { campaign.nextRunAt = iso(600000); data = { processed: 25 }; }
  } else if (path === "/api/dashboard") data = { total: 0, notContacted: 0, contacted: 0, replied: 0, followUps: 0, activities: [] };
  else if (path === "/api/companies") data = new URL(request.url).searchParams.has("page") ? { items: [], page: 1, total: 0, totalPages: 1, cities: [] } : [];
  // All API requests are intercepted: these tests cannot send Gmail or mutate the database.
  await send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify(data)).toString("base64") });
}
try {
  let targets;
  for (let i = 0; i < 100; i++) { try { targets = await (await fetch("http://127.0.0.1:9336/json/list")).json(); break; } catch { await delay(100); } }
  if (!targets) throw Error("Browser unavailable");
  socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener("open", r, { once: true }));
  socket.addEventListener("message", event => {
    const m = JSON.parse(event.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p?.reject(Error(JSON.stringify(m.error))); else p?.resolve(m.result); }
    else if (m.method === "Page.loadEventFired") { loadWaiters.splice(0).forEach(resolve => resolve()); }
    else if (m.method === "Fetch.requestPaused") void mock(m.params).catch(e => errors.push(String(e)));
    else if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails));
  });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await openMonitor();
  await waitFor("document.querySelector('.cm-delivery')?.textContent.includes('Endereço inexistente')");
  assert.equal(await evaluate("document.querySelectorAll('.cm-delivery img').length"), 0);
  assert.equal(await evaluate("document.querySelector('.cm-delivery').textContent.includes('Sem falha conhecida')"), true);
  await evaluate("(()=>{const el=document.querySelector('[aria-label=\"Categoria de entrega\"]');el.value='MAILBOX_FULL';el.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("document.querySelector('.cm-delivery')?.textContent.includes('Nenhum envio encontrado')");
  await evaluate("(()=>{const el=document.querySelector('[aria-label=\"Categoria de entrega\"]');el.value='';el.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await waitFor("document.querySelector('.cm-delivery-table')?.textContent.includes('Empresa devolvida')");
  checks.push("delivery report and category filter", "hostile diagnostic rendered as text only");
  assert.equal(await evaluate("document.querySelector('[role=progressbar]').getAttribute('aria-valuetext')"), "57 de 137 processados");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Nova empresa')"), false);
  const before = await evaluate("document.querySelector('.cm-countdown strong').textContent");
  const requestCount = requests.filter(r => r.path.endsWith("/monitor")).length;
  await delay(2200);
  assert.notEqual(await evaluate("document.querySelector('.cm-countdown strong').textContent"), before);
  assert.ok(requests.filter(r => r.path.endsWith("/monitor")).length - requestCount <= 1);
  await screenshot("running-desktop");
  checks.push("processed includes sent + failed + skipped", "countdown local and polling bounded", "Nova empresa hidden");

  for (const width of [768, 390, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: true });
    await delay(150);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=window.innerWidth"), true, "overflow at " + width);
    await screenshot("running-" + width);
  }
  checks.push("responsive 1440 / 768 / 390 / 320");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await click("Pausar campanha");
  await waitFor("document.querySelector('#cm-cycle-title').textContent==='Campanha pausada'");
  assert.equal(await evaluate("!!document.querySelector('.cm-countdown')"), false);
  await click("Retomar campanha", ".cm-cycle button");
  await waitFor("!!document.querySelector('.cm-countdown')");
  await click("Cancelar campanha");
  await waitFor("!!document.querySelector('[role=alertdialog]')");
  await click("Manter campanha"); assert.equal(campaign.status, "RUNNING");
  await click("Cancelar campanha"); await click("Confirmar cancelamento");
  await waitFor("document.querySelector('#cm-cycle-title').textContent==='Campanha cancelada'");
  await screenshot("cancelled");
  checks.push("pause", "resume", "cancel confirmation and dismissal");

  campaign = { ...fixture(), status: "READY", startedAt: null, nextRunAt: null, total: 7, pending: 7, sent: 0, failed: 0, skipped: 0 };
  monitoring = { ...monitoring, queued: 7 };
  await openMonitor(); await waitFor("document.querySelector('.cm-cycle').textContent.includes('Até 7 e-mails')");
  await screenshot("ready-small-campaign"); await click("Iniciar campanha", ".cm-cycle button");
  await waitFor("!!document.querySelector('.cm-countdown')");
  checks.push("READY start", "campaign under batch size", "zero failures / zero processed");

  campaign = { ...fixture(), pending: 6 }; monitoring.queued = 6;
  await openMonitor(); await waitFor("document.querySelector('.cm-cycle').textContent.includes('Até 6 e-mails')");
  checks.push("last batch smaller than 25");
  monitoring.remainingToday = 3;
  await openMonitor(); await waitFor("document.querySelector('.cm-cycle').textContent.includes('Até 3 e-mails')");
  checks.push("next batch capped by daily quota");

  campaign = { ...fixture(), nextRunAt: iso(36000000) }; monitoring.remainingToday = 0;
  await openMonitor(); await waitFor("document.querySelector('#cm-cycle-title').textContent==='Limite diário atingido'");
  assert.equal(await evaluate("!!document.querySelector('.cm-countdown')"), false);
  await screenshot("daily-limit"); checks.push("daily limit has no interval countdown");
  monitoring.remainingToday = 43; campaign = { ...fixture(), lockUntil: iso(300000), nextRunAt: iso(-10000) }; monitoring.processing = 1;
  await openMonitor(); await waitFor("document.querySelector('#cm-cycle-title').textContent==='Enviando lote atual…'");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pausar campanha').disabled"), true);
  assert.equal(await evaluate("document.querySelectorAll('[role=progressbar]').length"), 1);
  await screenshot("sending"); checks.push("server processing indeterminate and controls locked");

  monitoring.processing = 0; monitoring.uncertain = 3;
  reviews = [1, 2, 3].map(id => ({ id, companyName: "Revisão " + id, recipient: "revisao" + id + "@example.com", attempts: 1, updatedAt: iso(0) }));
  campaign = { ...fixture(), status: "PAUSED", nextRunAt: null };
  await openMonitor(); await waitFor("document.querySelectorAll('.cm-review-list article').length===3");
  await screenshot("review-required");
  await click("Confirmar enviado", ".cm-review-actions button"); await waitFor("document.querySelectorAll('.cm-review-list article').length===2");
  await click("Marcar falha", ".cm-review-actions button"); await waitFor("document.querySelectorAll('.cm-review-list article').length===1");
  await click("Autorizar reenvio", ".cm-review-actions button"); await waitFor("!document.querySelector('.cm-review')");
  await waitFor("[...document.querySelectorAll('.cm-cycle button')].some(b=>b.textContent==='Retomar campanha'&&!b.disabled)");
  checks.push("all three review actions", "resume only after review");

  campaign = { ...fixture(), status: "COMPLETED", sent: 125, failed: 3, skipped: 9, pending: 0, completedAt: iso(0), nextRunAt: null };
  await openMonitor(); await waitFor("document.querySelector('#cm-cycle-title').textContent==='Campanha concluída'");
  assert.equal(await evaluate("document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')"), "100");
  assert.equal(await evaluate("!!document.querySelector('.cm-controls')"), false);
  await screenshot("completed"); checks.push("COMPLETED");

  campaign = fixture(); await openMonitor(); failMonitor = true;
  await waitFor("document.querySelector('.cm-notice')?.textContent.includes('Não foi possível atualizar agora')");
  assert.equal(await evaluate("document.querySelector('[role=progressbar]').getAttribute('aria-valuetext')"), "57 de 137 processados");
  await screenshot("polling-error"); failMonitor = false;
  await waitFor("!document.querySelector('.cm-notice')"); checks.push("polling failure retains data and recovers");

  campaign = { ...fixture(), logicalBatch: { id: "logical-batch", recipientIds: [1, 2], startedAt: Date.now() }, processingNotice: "Processamento adiado. Será tentado novamente." };
  monitoring.activities = [{ id: 4, companyName: "Empresa adiada", recipient: "adiado@example.test", status: "PENDING", failureCategory: "INFRASTRUCTURE_FAILURE", errorMessage: "Limite temporário da infraestrutura atingido. Será tentado novamente.", updatedAt: iso(0) }];
  await openMonitor();
  await waitFor("document.querySelector('.cm-activity')?.textContent.includes('Processamento adiado')");
  assert.equal(await evaluate("document.querySelector('.cm-activity').textContent.includes('Falha no envio')"), false);
  await waitFor("document.querySelector('.cm-cycle')?.textContent.includes('Concluindo o lote atual')");
  assert.equal(await evaluate("document.querySelector('#cm-cycle-title').textContent"), "Continuação do lote atual");
  await screenshot("infrastructure-deferred"); checks.push("infrastructure deferral is not a permanent send failure", "logical batch continuation");

  campaign = { ...fixture(), nextRunAt: iso(1800) }; holdProcessing = true; await openMonitor();
  await waitFor("document.querySelector('.cm-countdown')?.textContent.includes('Preparando próximo lote')");
  assert.equal(await evaluate("document.querySelector('#cm-cycle-title').textContent"), "Próximo lote");
  checks.push("zero countdown does not claim sending");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.cm-interval span')).animationName"), "none");
  checks.push("reduced motion");
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ passed: true, checks, requests, errors }, null, 2));
  console.log("Campaign UI checks passed: " + checks.length + ". Screenshots: " + output);
} catch (error) {
  if (socket?.readyState === 1) { await screenshot("failure").catch(() => {}); console.error(await evaluate("document.body.innerText").catch(() => ""), errors); }
  console.error("API requests", requests); throw error;
} finally {
  if (socket?.readyState === 1) { await send("Browser.close").catch(() => {}); socket.close(); }
  browser.kill();
}
