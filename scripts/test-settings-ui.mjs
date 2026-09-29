import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const baseUrl=process.env.SETTINGS_TEST_URL||"http://localhost:5173";
const output=resolve("outputs/settings-qa");mkdirSync(output,{recursive:true});
const browser=spawn(process.env.CHROME_BINARY||"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--remote-debugging-port=9334","--user-data-dir="+mkdtempSync(join(tmpdir(),"prospecta-settings-qa-")),"about:blank"],{windowsHide:true,stdio:"ignore"});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let socket,seq=0,failSettings=false,failSave=false,slow=false,failGmail=false;
const pending=new Map(),errors=[],requests=[],loadWaiters=[];
let config={senderName:"Pessoa de teste",signature:"Atenciosamente,\nEquipe de teste",dailySendLimit:100,timezone:"America/Sao_Paulo"};
let gmail={configured:true,connected:true,needsReconnect:false,account:{email:"teste@example.com",connectedAt:"2026-09-20T12:00:00Z"},scopes:["openid","email","https://www.googleapis.com/auth/gmail.send"]};
const summary={companies:12,contacts:18,sent:9,failed:1,sentToday:3,dailySendLimit:100,timezone:"America/Sao_Paulo",updatedAt:new Date().toISOString(),followups:{total:4,pending:3,overdue:1,completed:1},imports:[{id:1,fileName:"exemplo.xlsx",totalRows:12,importedRows:10,updatedRows:0,skippedRows:1,errorRows:1,createdAt:new Date().toISOString()}]};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
async function evaluate(expression){const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitFor(expression){for(let i=0;i<160;i++){if(await evaluate(expression).catch(()=>false))return;await delay(100);}throw new Error("Timeout: "+expression);}
async function click(text,selector="button"){await evaluate("(()=>{const el=[...document.querySelectorAll("+JSON.stringify(selector)+")].find(e=>e.textContent.trim()==="+JSON.stringify(text)+");if(!el)throw Error('Missing '+ "+JSON.stringify(text)+");el.click();})()");await delay(100);}
async function tab(id){await evaluate("(()=>{const el=document.querySelector('.preferences-mobile-nav select');el.value="+JSON.stringify(id)+";el.dispatchEvent(new Event('change',{bubbles:true}));})()");await delay(100);}
async function fill(selector,value){await evaluate("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));})()");await delay(100);}
async function reload(){const loaded=new Promise(resolve=>loadWaiters.push(resolve));await send("Page.reload");await loaded;}
async function screenshot(name){const r=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});writeFileSync(resolve(output,name+".png"),Buffer.from(r.data,"base64"));}
async function mock({requestId,request}){
 const path=new URL(request.url).pathname;requests.push({path,method:request.method});let data=[],status=200;
 if(path==="/api/settings"){if(slow)await delay(900);if(failSettings){data={error:"Falha simulada"};status=503;}else if(request.method==="PATCH"){await delay(300);if(failSave){data={error:"Falha ao salvar simulada"};status=500;}else{config=JSON.parse(request.postData);data=config;}}else data=config;}
 else if(path==="/api/gmail/status"){if(request.method==="DELETE")gmail={...gmail,connected:false,account:null,scopes:[]};data=gmail;if(failGmail){status=503;data={error:"Falha Gmail simulada"};}}
 else if(path==="/api/settings/summary")data={...summary,dailySendLimit:config.dailySendLimit};
 else if(path==="/api/dashboard")data={total:12,notContacted:12,contacted:0,replied:0,followUps:3,sentToday:3,sentWeek:9,responseRate:0,activities:[]};
 else if(path==="/api/companies")data=new URL(request.url).searchParams.has("page")?{items:[],page:1,pageSize:50,total:0,totalPages:1,cities:[]}:[];
 else if(path==="/api/emails"&&request.method==="POST")data={id:1,status:"SENT"};
 await send("Fetch.fulfillRequest",{requestId,responseCode:status,responseHeaders:[{name:"content-type",value:"application/json"}],body:Buffer.from(JSON.stringify(data)).toString("base64")});
}
try {
 for(let i=0;i<240;i++){try{const response=await fetch(baseUrl+"/workspace",{signal:AbortSignal.timeout(3000)});if(response.ok)break;}catch{}if(i===239)throw Error("Development server unavailable");await delay(500);}
 let targets;
 for(let i=0;i<80;i++){try{targets=await(await fetch("http://127.0.0.1:9334/json/list")).json();break;}catch{await delay(100);}}
 socket=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
 await new Promise(r=>socket.addEventListener("open",r,{once:true}));
 socket.addEventListener("message",event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error(JSON.stringify(m.error)));else p?.resolve(m.result);}else if(m.method==="Page.loadEventFired")loadWaiters.splice(0).forEach(resolve=>resolve());else if(m.method==="Fetch.requestPaused")void mock(m.params).catch(e=>errors.push(String(e)));else if(m.method==="Runtime.consoleAPICalled" && m.params.type==="error")errors.push(JSON.stringify(m.params.args));else if(m.method==="Runtime.exceptionThrown")errors.push(JSON.stringify(m.params.exceptionDetails));});
 await send("Page.enable");await send("Runtime.enable");await send("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
 await send("Page.addScriptToEvaluateOnNewDocument",{source:"window.confirm=()=>true"});
 await send("Emulation.setDeviceMetricsOverride",{width:1536,height:1024,deviceScaleFactor:1,mobile:false});
 await send("Page.navigate",{url:baseUrl+"/workspace?settings=general"});
 await waitFor("!!document.querySelector('#sender-name')");
 assert.equal(await evaluate("document.querySelector('.preferences-header button').disabled"),true);
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.topbar')).display"),"none");
 await fill("#sender-name","Remetente alterado");await tab("emails");await fill("#signature","Assinatura QA");
 await tab("general");assert.equal(await evaluate("document.querySelector('#sender-name').value"),"Remetente alterado");
 const gets=requests.filter(r=>r.method==="GET"&&r.path==="/api/settings").length;
 await click("Salvar alterações");await waitFor("document.querySelector('.preferences-header button').disabled && document.querySelector('.preferences-header small').textContent==='Salvamento manual'");
 assert.equal(config.senderName,"Remetente alterado");assert.equal(config.signature,"Assinatura QA");
 for(const id of ["general","gmail","emails","sending","followups","data","security"]){await tab(id);await screenshot(id+"-desktop");assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false);}
 assert.equal(requests.filter(r=>r.method==="GET"&&r.path==="/api/settings").length,gets);
 await tab("emails");await evaluate("history.back()");await waitFor("document.querySelector('#settings-section-title').textContent==='Segurança'");await evaluate("history.forward()");await waitFor("document.querySelector('#signature')!==null");
 await reload();await waitFor("!!document.querySelector('#signature')");
 await tab("sending");await fill("#daily-limit","501");assert.equal(await evaluate("document.querySelector('.preferences-header button').disabled"),true);await fill("#daily-limit","100");
 await tab("gmail");await fill("#test-recipient","qa@example.com");await click("Enviar teste");await waitFor("document.body.innerText.includes('E-mail de teste enviado.')");assert.equal(requests.filter(r=>r.path==="/api/emails"&&r.method==="POST").length,1);
 failGmail=true;await click("Atualizar dados");await waitFor("document.body.innerText.includes('Falha Gmail simulada')");failGmail=false;await click("Tentar novamente");await waitFor("!!document.querySelector('#test-recipient')");
 await click("Desconectar");await waitFor("document.body.innerText.includes('Nenhuma conta conectada')");await screenshot("gmail-disconnected");
 for(const width of [820,390]){await send("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<500});for(const id of ["general","gmail","emails","sending","followups","data","security"]){await tab(id);assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false,"Overflow "+width+" "+id);await screenshot(id+"-"+width);}}
 await evaluate("document.querySelector('.menu-button').click()");assert.equal(await evaluate("document.querySelector('.sidebar').classList.contains('open')"),true);await evaluate("document.querySelector('.mobile-close').click()");
 await tab("general");await fill("#sender-name","Rascunho mantido");failSave=true;await click("Salvar alterações");await waitFor("document.body.innerText.includes('Falha ao salvar simulada')");assert.equal(await evaluate("document.querySelector('#sender-name').value"),"Rascunho mantido");failSave=false;
 await evaluate("window.confirm=()=>false");await evaluate("document.querySelector('.sidebar nav button').click()");assert.ok(await evaluate("!!document.querySelector('.preferences-page')"));
 await evaluate("window.confirm=()=>true");await click("Salvar alterações");await waitFor("document.querySelector('.preferences-header small').textContent==='Salvamento manual'");
 failSettings=true;await reload();await waitFor("document.body.innerText.includes('Falha simulada')");await screenshot("settings-error");
 failSettings=false;slow=true;await click("Tentar novamente");await waitFor("!!document.querySelector('[aria-label=\"Carregando configurações\"]')");await screenshot("settings-loading");await waitFor("!!document.querySelector('#sender-name')");slow=false;
 summary.imports=[];summary.followups={total:0,pending:0,overdue:0,completed:0};await tab("data");await click("Atualizar dados");await waitFor("document.body.innerText.includes('Nenhuma importação registrada')");
 await send("Emulation.setDeviceMetricsOverride",{width:1536,height:1024,deviceScaleFactor:1,mobile:false});
 for(const label of ["Visão geral","Empresas","Contatos","E-mails","Envio em lote","Templates","Importações","Follow-ups"]){await evaluate("(()=>{const b=[...document.querySelectorAll('.sidebar nav button')].find(e=>e.querySelector('span').textContent==="+JSON.stringify(label)+");b.click();})()");await delay(450);assert.equal(await evaluate("!!document.querySelector('.preferences-page')"),false);}
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(output,"report.json"),JSON.stringify({passed:true,checks:["7 tabs","dirty state","save success/error","draft preserved","deep link/reload/back/forward","no duplicated settings requests","connected/disconnected Gmail","loading/error/empty","1536/820/390 no overflow","mobile menu","all other modules navigation"],requests,errors},null,2));
 console.log("Settings UI checks passed: "+output);
} catch(error){if(socket?.readyState===1){await screenshot("failure").catch(()=>{});console.error(await evaluate("document.body.innerText").catch(()=>""),errors);}throw error;}
finally {if(socket?.readyState===1){await send("Browser.close").catch(()=>{});socket.close();}browser.kill();}
