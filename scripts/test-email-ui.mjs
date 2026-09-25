import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const output=resolve("outputs/attachments-qa");mkdirSync(output,{recursive:true});
const browser=spawn(process.env.CHROME_BINARY||"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--remote-debugging-port=9333","--user-data-dir="+resolve(output,"browser-profile"),"about:blank"],{windowsHide:true,stdio:"ignore"});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let socket,seq=0;
const pending=new Map(),requests=[],errors=[];
let templates=[],messages=[],nextId=1,uploadNumber=0;
const company={id:1,name:"Empresa Teste São Paulo",city:"São Paulo",state:"SP",segment:"Tecnologia",primaryEmail:"empresa@example.com"};
const contact={id:2,name:"João",email:"joao@example.com",isPrimary:true};
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
async function evaluate(expression){const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitFor(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw new Error("Timeout: "+expression);}
async function clickText(text,selector="button"){await evaluate("(()=>{const el=[...document.querySelectorAll("+JSON.stringify(selector)+")].find(e=>e.textContent.trim()==="+JSON.stringify(text)+");if(!el)throw new Error('Missing button '+ "+JSON.stringify(text)+");el.click();})()");await delay(80);}
async function fill(selector,value){await evaluate("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");if(!el)throw new Error('Missing input');const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));})()");await delay(70);}
async function upload(names){await evaluate("(()=>{const el=document.querySelector('input[type=file]');const dt=new DataTransfer();"+JSON.stringify(names)+".forEach(name=>dt.items.add(new File(['%PDF-1.4\\nTest'],name,{type:'application/pdf'})));el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()");await waitFor("!document.body.innerText.includes('Adicionando arquivos…')");}
async function screenshot(name){await delay(350);const r=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});writeFileSync(resolve(output,name+".png"),Buffer.from(r.data,"base64"));}
async function chooseCompany(){
  await evaluate("document.querySelector('input[aria-label=\"Pesquisar empresa\"]').focus()");
  await fill('input[aria-label="Pesquisar empresa"]',"Empresa");
  await waitFor("!!document.querySelector('.company-search-results button')");
  await clickText(company.name+"São Paulo/SP · empresa@example.com",".company-search-results button");
  await delay(350);
}
async function mock(event){
  const {requestId,request}=event,url=new URL(request.url);
  requests.push({path:url.pathname,query:url.search,method:request.method});
  let data={},status=200;
  if(url.pathname==="/api/templates"){
    if(request.method==="GET")data=templates;
    else if(request.method==="POST"||request.method==="PATCH"){
      const input=JSON.parse(request.postData),id=request.method==="PATCH"?Number(url.searchParams.get("id")):nextId++;
      const old=templates.find(t=>t.id===id);
      data={...input,id,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),attachments:allFiles.filter(f=>input.attachmentIds.includes(f.id))};
      templates=[data,...templates.filter(t=>t.id!==id)];
    }else {templates=templates.filter(t=>t.id!==Number(url.searchParams.get("id")));data={ok:true};}
  }else if(url.pathname==="/api/attachments"){
    uploadNumber++;
    const names=uploadNumber===1?["proposta São Paulo.pdf","catálogo.pdf"]:["apresentação.pdf"];
    data=names.map(name=>({id:crypto.randomUUID(),name,mimeType:"application/pdf",size:14}));
    allFiles.push(...data);await delay(180);
  }else if(url.pathname==="/api/companies")data=[company];
  else if(url.pathname==="/api/companies/1")data={company,contacts:[contact],activities:[]};
  else if(url.pathname==="/api/gmail/status")data={configured:true,connected:true,needsReconnect:false,account:{email:"sender@example.com",connectedAt:new Date().toISOString()}};
  else if(url.pathname==="/api/emails"){
    if(request.method==="GET")data=messages;
    else{const input=JSON.parse(request.postData);data={...input,id:messages.length+1,status:"SENT",companyName:company.name,createdAt:new Date().toISOString(),attachments:allFiles.filter(f=>input.attachmentIds.includes(f.id))};messages.unshift(data);}
  }else if(url.pathname==="/api/dashboard")data={total:1,notContacted:1,contacted:0,followUps:0,recentActivities:[],activities:[]};
  else {status=404;data={error:"Unexpected mocked API: "+url.pathname};}
  await send("Fetch.fulfillRequest",{requestId,responseCode:status,responseHeaders:[{name:"content-type",value:"application/json"}],body:Buffer.from(JSON.stringify(data)).toString("base64")});
}
const allFiles=[];
try{
  let targets;
  for(let i=0;i<80;i++){try{targets=await(await fetch("http://127.0.0.1:9333/json/list")).json();break;}catch{await delay(100);}}
  if(!targets)throw new Error("Browser did not start");
  socket=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
  await new Promise(r=>socket.addEventListener("open",r,{once:true}));
  socket.addEventListener("message",event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(new Error(JSON.stringify(m.error)));else p?.resolve(m.result);}else if(m.method==="Fetch.requestPaused")void mock(m.params).catch(e=>errors.push(String(e)));else if(m.method==="Runtime.exceptionThrown")errors.push(JSON.stringify(m.params.exceptionDetails));});
  await send("Page.enable");await send("Page.bringToFront");await send("Emulation.setFocusEmulationEnabled",{enabled:true});await send("Runtime.enable");await send("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:"http://localhost:5174/workspace"});
  await waitFor("!!document.querySelector('nav[aria-label=\"Navegação principal\"]')");
  await clickText("Templates");
  await waitFor("!!document.querySelector('#template-name') && !document.querySelector('#template-name').matches(':disabled')");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>/^(Novo template|Criar template)$/.test(b.textContent.trim()))"),false);
  await screenshot("templates-empty-desktop");
  await fill("#template-name","Prospecção inicial");
  await fill("#template-subject","Olá, !");await evaluate("document.querySelector('#template-subject').focus();document.querySelector('#template-subject').setSelectionRange(5,5)");assert.equal(await evaluate("document.activeElement.id"),"template-subject");
  await clickText("Empresa",".variable-bar button");
  assert.equal(await evaluate("document.querySelector('#template-subject').value"),"Olá, {{empresa}}!");
  await fill("#template-body","Olá, !");await evaluate("document.querySelector('#template-body').focus();document.querySelector('#template-body').setSelectionRange(5,5)");
  await clickText("Contato",".variable-bar button");
  assert.equal(await evaluate("document.querySelector('#template-body').value"),"Olá, {{contato}}!");
  await upload(["proposta São Paulo.pdf","catálogo.pdf"]);
  await waitFor("document.querySelectorAll('.attachment-list li').length===2");
  await evaluate("document.querySelector('[aria-label=\"Remover catálogo.pdf\"]').click()");
  await clickText("Salvar");
  await waitFor("document.body.innerText.includes('Template salvo.')");
  assert.equal(templates[0].attachments.length,1);
  await send("Page.reload");
  await waitFor("!!document.querySelector('nav[aria-label=\"Navegação principal\"]')");
  await clickText("Templates");
  await waitFor("!!document.querySelector('.template-items button')");
  await evaluate("document.querySelector('.template-items button').click()");
  await waitFor("document.querySelector('#template-name')?.value==='Prospecção inicial'");
  assert.equal(await evaluate("document.querySelectorAll('.attachment-list li').length"),1);
  await clickText("Pré-visualizar");await chooseCompany();
  await waitFor("document.querySelector('.preview-body')?.textContent==='Olá, João!'");
  assert.equal(await evaluate("document.querySelector('.preview-subject h3').textContent"),"Olá, Empresa Teste São Paulo!");
  await screenshot("template-preview-desktop");
  await clickText("Voltar ao editor");
  await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await screenshot("template-editor-mobile");
  assert.equal(await evaluate("document.documentElement.scrollWidth<=window.innerWidth"),true);
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await clickText("E-mails");
  await waitFor("!!document.querySelector('.send-form')");
  await chooseCompany();
  await evaluate("document.querySelectorAll('.send-grid [role=combobox]')[1].click()");
  await waitFor("!!document.querySelector('[role=option]')");
  await clickText("Prospecção inicial","[role=option]");
  await waitFor("document.querySelectorAll('.attachment-list li').length===1");
  assert.equal(await evaluate("document.querySelector('.send-grid textarea').value"),"Olá, João!");
  await evaluate("document.querySelector('[aria-label=\"Remover proposta São Paulo.pdf\"]').click()");
  await upload(["apresentação.pdf"]);
  assert.equal(templates[0].attachments[0].name,"proposta São Paulo.pdf");
  await screenshot("email-attachments-desktop");
  await clickText("Enviar agora");
  await waitFor("document.body.innerText.includes('E-mail enviado pelo Gmail.')");
  assert.equal(messages[0].attachments.length,1);assert.equal(messages[0].attachments[0].name,"apresentação.pdf");
  await waitFor("document.querySelectorAll('.attachment-list li').length===0");
  await fill(".send-grid input[placeholder='Assunto do e-mail']","Sem anexos");
  await fill(".send-grid textarea","Mensagem sem anexos");
  await clickText("Enviar agora");await waitFor("document.querySelector('.email-history-list')?.textContent.includes('Sem anexos')");
  assert.equal(messages[0].attachments.length,0);
  assert.ok(requests.filter(r=>r.path==="/api/companies").every(r=>new URLSearchParams(r.query).has("limit")));
  assert.deepEqual(errors,[]);
  writeFileSync(resolve(output,"report.json"),JSON.stringify({passed:true,requests,checks:["empty state","cursor subject/body","multiple uploads","individual removal","save/reload","real-company preview (mock)","mobile no overflow","inherit/send-only removal","send-specific upload","history","send without attachments","bounded company queries"],errors},null,2));
  console.log("UI checks passed; screenshots and request report: "+output);
}catch(error){if(socket?.readyState===1){await screenshot("failure").catch(()=>{});console.error(await evaluate("document.body.innerText").catch(()=>""),errors);}throw error;}
finally{if(socket?.readyState===1){await send("Browser.close").catch(()=>{});socket.close();}browser.kill();}
