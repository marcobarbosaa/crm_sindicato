import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { syntheticPdf } from './smart-pdf-fixtures.mjs';

// Local workerd sampling, NOT production billed CPU. Database/network are mocked.
// No environment files, credentials, production documents or external requests.
const require = createRequire(import.meta.url);
const { Miniflare, NoOpLog } = require(require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }));
const { build } = require(require.resolve('esbuild', { paths: [require.resolve('wrangler/package.json')] }));
const label = process.argv[2] || 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Use an alphanumeric profile label');
const output = resolve('outputs/smart-cpu', label);
const baseline = process.argv[3];
if (baseline && !/^[0-9a-f]{7,40}$/.test(baseline)) throw Error('Baseline must be a commit hash');
await mkdir(output, { recursive: true });

const mockDb = `
import { getTableName } from 'drizzle-orm';
let count = 0;
export function setCount(n) { count = n; }
export function getDb() { return { select(projection) {
  let table;
  const query = { from(t) { table = t; return query; }, where() { return query; }, orderBy() { return query; },
    then(resolve) {
      const now = new Date(0), name = getTableName(table);
      let rows = name === 'document_send_batches' ? [{id: 1, ownerId:'synthetic', name:'Synthetic', status:'DRAFT', templateId:null, accountId:null, deletionRequestedAt:null, commonAttachments:[]}] :
        name === 'document_send_items' ? Array.from({length:count}, (_,i) => ({id:String(i), batchId:1, ownerId:'synthetic', companyId:1, candidates:[1], extractedCnpjs:['11222333000181'],
          fileName:'synthetic.pdf', fileSize:1024, contentHash:'a'.repeat(64), storageKey:'private', deliveryLockToken:'private', fileReady:true, fileDeletedAt:null, removedAt:null, duplicateOf:null,
          readable:true, reviewStatus:'READY', confirmedAt:now, excluded:false, recipient:'synthetic@example.test', sendStatus:'DRAFT', subject:'Review', body:'Synthetic preview '.repeat(50),
          messageId:null, error:null, createdAt:now, updatedAt:now})) : name === 'companies' ? [{id:1,name:'Synthetic',primaryEmail:'synthetic@example.test'}] :
        name === 'crm_settings' ? [{dailySendLimit:100}] : name === 'email_accounts' ? [{email:'synthetic@example.test'}] : [];
      if (projection) rows = rows.map(row => Object.fromEntries(Object.keys(projection).map(key => [key,row[key]])));
      return Promise.resolve(rows).then(resolve);
    }};
  return query;
}}; }
export const withCampaignDb = fn => fn();`;
const bundle = await build({ stdin: { contents: `
import { GET } from './app/api/smart-sends/[[...path]]/route.ts';
import { setCount } from '@/db';
import { readPdfText } from './lib/pdf-text.ts';
import { contentHash } from './lib/smart-send-storage.ts';
import { extractCnpjs } from './lib/pdf-company-matcher.ts';
import { normalizeSmartApiIds } from './lib/smart-send-contract.ts';
import { generateKeyPair, SignJWT, jwtVerify } from 'jose';
let credentials;
const hashBytes = new Uint8Array(4 * 1024 * 1024);
const contractFixture = {batch:{id:'1',templateId:null,accountId:null},items:Array.from({length:100},(_,i)=>({id:String(i),companyId:'1',candidates:['1'],suggestions:[{id:'1',name:'Synthetic'}],subject:'Review',body:'Synthetic preview '.repeat(50)}))};
export default { async fetch(r) {
  const u = new URL(r.url);
  if (u.pathname === '/setup') {
    const pair=await generateKeyPair('RS256');
    credentials={key:pair.publicKey,token:await new SignJWT({email:'synthetic@example.test'}).setProtectedHeader({alg:'RS256'}).setIssuer('synthetic').setAudience('synthetic').setSubject('synthetic').setIssuedAt().setExpirationTime('1h').sign(pair.privateKey)};
    return new Response('ok');
  }
  if (u.pathname === '/jwt') {
    await jwtVerify(credentials.token,credentials.key,{issuer:'synthetic',audience:'synthetic',algorithms:['RS256'],requiredClaims:['exp','iat','sub','email']});
    return new Response('true');
  }
  if (u.pathname === '/hash') { await contentHash(hashBytes); return new Response('true'); }
  if (u.pathname === '/normalize') {
    let result;
    for (let i=0;i<100;i++) result=normalizeSmartApiIds('1',contractFixture);
    return Response.json({items:result.items.length});
  }
  if (u.pathname === '/pdf') {
    const bytes = new Uint8Array(await r.arrayBuffer());
    const hash = await contentHash(bytes), result = await readPdfText(bytes);
    return Response.json({hash, readable:result.readable,error:result.error,chars:result.text.length,cnpjs:extractCnpjs(result.text).length});
  }
  setCount(Number(u.searchParams.get('count')));
  return GET(r, {params:Promise.resolve({path:u.pathname === '/status' ? ['1','import-status'] : ['1']})});
}};`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'neutral', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:workers', 'node:*', '@napi-rs/canvas', 'pdfjs-dist', 'pdfjs-dist/*'], logLevel: 'silent',
  plugins: [{name:'synthetic-boundaries', setup(b) {
    b.onResolve({filter:/^@\/db$/}, () => ({path:'db',namespace:'synthetic'}));
    b.onResolve({filter:/^next\/server$/}, () => ({path:'next',namespace:'synthetic'}));
    b.onResolve({filter:/smart-send-auth$/}, () => ({path:'auth',namespace:'synthetic'}));
    b.onLoad({filter:/.*/,namespace:'synthetic'}, ({path}) => ({contents:path === 'db' ? mockDb : path === 'auth' ? `export const smartOwner = async () => 'synthetic';` : `export const NextResponse = {json:(v,i)=>Response.json(v,i)};`,resolveDir:process.cwd()}));
    if (baseline) b.onLoad({filter:/(smart-send-service|smart-send-contract|pdf-text|pdf-company-matcher)\.ts$|smart-sends[\\/]\[\[\.\.\.path\]\][\\/]route\.ts$/}, ({path}) => ({
      contents:execFileSync('git',['show',baseline+':'+path.slice(process.cwd().length+1).replaceAll('\\','/')],{encoding:'utf8'}),loader:'ts',resolveDir:resolve(path,'..'),
    }));
  }}] });
const mf = new Miniflare({ log:new NoOpLog(), modules:true, compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'],
  inspectorPort:0, script:bundle.outputFiles[0].text, outboundService:() => { throw Error('External requests forbidden'); } });
let socket;
try {
  const inspector = await mf.getInspectorURL();
  inspector.protocol = 'http:';
  const targets = await (await fetch(new URL('/json/list', inspector))).json();
  socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((ok,fail) => { socket.addEventListener('open',ok,{once:true}); socket.addEventListener('error',fail,{once:true}); });
  let nextId = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); const callbacks = pending.get(message.id); if (callbacks) { pending.delete(message.id); if (message.error) callbacks.reject(Error(message.error.message)); else callbacks.resolve(message.result); } });
  const cdp = (method,params={}) => new Promise((resolve,reject) => { const id=++nextId; pending.set(id,{resolve,reject}); socket.send(JSON.stringify({id,method,params})); });
  await cdp('Profiler.enable');
  await cdp('Profiler.setSamplingInterval',{interval:100});
  await (await mf.dispatchFetch('http://worker.test/setup')).text();
  const cases = [
    ...[0,30,100].map(count => ({name:'get-'+count,url:'/detail?count='+count,repeats:30})),
    {name:'import-status-100',url:'/status?count=100',repeats:30},
    {name:'normalize-100-items-x100',url:'/normalize',repeats:10},
    {name:'jwt-rs256-cached-key',url:'/jwt',repeats:30},
    {name:'sha256-4mib',url:'/hash',repeats:10},
    {name:'pdf-small-cold',body:syntheticPdf(),repeats:1},
    {name:'pdf-small-warm',body:syntheticPdf(),repeats:10},
    {name:'pdf-50-pages',body:syntheticPdf({pages:50}),repeats:3},
    {name:'pdf-complex',body:syntheticPdf({pages:10,operations:300,compressed:true}),repeats:3},
    {name:'pdf-corrupt',body:Buffer.from('%PDF-broken'),repeats:3},
  ];
  const results = [];
  for (const scenario of cases) {
    await cdp('Profiler.start'); const start = performance.now(); let size=0, result;
    for (let i=0;i<scenario.repeats;i++) {
      const response = await mf.dispatchFetch('http://worker.test'+(scenario.url || '/pdf'),scenario.body ? {method:'POST',body:scenario.body} : {});
      const body=await response.text(); size=Buffer.byteLength(body); result=JSON.parse(body);
      if (!response.ok) throw Error('Synthetic request failed: '+response.status);
      if (scenario.name.startsWith('pdf-') && scenario.name !== 'pdf-corrupt' && !result.readable) throw Error('Synthetic PDF unreadable');
    }
    const wallMs=performance.now()-start, {profile}=await cdp('Profiler.stop');
    const heap=await cdp('Runtime.getHeapUsage');
    await writeFile(resolve(output,scenario.name+'.cpuprofile'),JSON.stringify(profile));
    const nodes=new Map(profile.nodes.map(n=>[n.id,n])), frames=new Map(); let sampledActiveUs=0;
    for (let i=0;i<(profile.samples||[]).length;i++) {
      const frame=nodes.get(profile.samples[i])?.callFrame, us=profile.timeDeltas?.[i] || 0;
      if (!frame || ['(idle)','(program)','(root)'].includes(frame.functionName)) continue;
      sampledActiveUs+=us; const name=frame.functionName||'(anonymous)'; frames.set(name,(frames.get(name)||0)+us);
    }
    const row={scenario:scenario.name,requests:scenario.repeats,wallMsPerRequest:wallMs/scenario.repeats,
      sampledActiveMsPerRequest:sampledActiveUs/1000/scenario.repeats,responseBytes:size,
      retainedHeapBytes:heap.usedSize,
      ...(scenario.body ? {inputBytes:scenario.body.length,readable:result.readable,error:result.error} : {}),
      topFrames:[...frames].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,us])=>({name,sampledMs:us/1000}))};
    results.push(row); console.log(JSON.stringify(row));
  }
  await writeFile(resolve(output,'summary.json'),JSON.stringify({runtime:'local workerd',baseline:baseline||null,caveat:'Sampling estimate affected by host scheduling and inspector; excludes mocked JWT/PostgreSQL/storage/framework. Not production CPU or limit compliance.',bundleBytes:bundle.outputFiles[0].contents.length,results},null,2));
} finally { socket?.close(); await mf.dispose(); }
