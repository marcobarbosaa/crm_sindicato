import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {Miniflare,NoOpLog}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
const {build}=require(require.resolve('esbuild',{paths:[require.resolve('wrangler/package.json')]}));
const output=resolve('outputs/smart-deletion-cpu'); await mkdir(output,{recursive:true});
// This double exercises real Drizzle expression construction and orchestration,
// but deliberately excludes PostgreSQL/TLS/network CPU. Correctness uses PGlite tests.
const database=`
import {getTableName} from 'drizzle-orm';
let batch,rows,selected=0;
export let queries=0,transactions=0;
export function fixture(count) {
 queries=0;transactions=0;selected=0;
 batch={id:1,ownerId:'synthetic',status:'CANCELLED',deletionRequestedAt:new Date(0),deletedAt:null,confirmedAt:null,completedAt:null,nextRunAt:null,lockToken:null,lockUntil:null};
 rows=Array.from({length:count},(_,i)=>{const id='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');return {id,ownerId:'synthetic',batchId:1,storageKey:'smart-sends/'+id+'.pdf',removedAt:new Date(0),sendStatus:'DRAFT',importActiveAt:null,fileDeletedAt:null};});
}
const db={
 transaction:async fn=>{transactions++;return fn(db);},
 select(projection){let table,limit=Infinity;const q={from(t){table=t;return q;},where(){return q;},orderBy(){return q;},limit(n){limit=n;return q;},for(){return q;},then(ok,no){
 queries++;let result;
 if(projection?.blocked) result=[{blocked:false}];
 else if(getTableName(table)==='document_send_batches') result=[{...batch}];
 else {result=rows.filter(row=>!row.fileDeletedAt).slice(0,limit);if(projection?.storageKey) selected=result.length;}
 if(projection && !projection.blocked) result=result.map(row=>Object.fromEntries(Object.keys(projection).map(key=>[key,row[key]])));
 return Promise.resolve(result).then(ok,no);
 }};return q;},
 update(table){return {set(values){return {where(){queries++;if(getTableName(table)==='document_send_batches')Object.assign(batch,values);else rows.filter(r=>!r.fileDeletedAt).slice(0,selected).forEach(r=>Object.assign(r,values));return Promise.resolve();}};}};},
 delete(){return {where(){queries++;rows=[];return Promise.resolve();}};}
};
export const getDb=()=>db;`;
const bundle=await build({stdin:{contents:`import {processBatchDeletion} from './lib/smart-batch-management.ts';import {fixture,queries,transactions} from '@/db';export default {async fetch(r){fixture(Number(new URL(r.url).searchParams.get('count')));const result=await processBatchDeletion();return Response.json({...result,queries,transactions});}};`,resolveDir:process.cwd()},
 bundle:true,write:false,format:'esm',platform:'neutral',target:'es2022',conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:*'],logLevel:'silent',
 plugins:[{name:'synthetic-db',setup(b){b.onResolve({filter:/^@\/db$/},()=>({path:'db',namespace:'synthetic'}));b.onLoad({filter:/.*/,namespace:'synthetic'},()=>({contents:database,resolveDir:process.cwd()}));}}]});
let mode='success',calls=0;
const mf=new Miniflare({log:new NoOpLog(),modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],inspectorPort:0,script:bundle.outputFiles[0].text,
 bindings:{SUPABASE_URL:'https://synthetic.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic',SMART_SEND_BUCKET:'private'},
 outboundService:async request=>{
  calls++;const url=new URL(request.url);assert.equal(url.hostname,'synthetic.test');
  if(url.pathname.includes('/bucket/'))return Response.json({public:false});
  if(request.method==='DELETE') {const {prefixes}=await request.json();assert.ok(prefixes.length<=5);return Response.json(mode==='absent'?[]:prefixes.map(name=>({name})));}
  assert.match(url.pathname,/\/object\/info\//);return Response.json({code:'NoSuchKey'},{status:404});
 }});
let socket;
try {
 const inspector=await mf.getInspectorURL();inspector.protocol='http:';
 const targets=await(await fetch(new URL('/json/list',inspector))).json();socket=new WebSocket(targets[0].webSocketDebuggerUrl);
 await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map();
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data),p=pending.get(m.id);if(p){pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 await cdp('Profiler.enable');await cdp('Profiler.setSamplingInterval',{interval:100});
 const results=[];
 for(const scenario of [{name:'five-cold',count:5,repeats:1},{name:'empty',count:0,repeats:30},{name:'one',count:1,repeats:30},{name:'five',count:5,repeats:30},{name:'twenty-first-group',count:20,repeats:30},{name:'five-absent-retry',count:5,repeats:30,mode:'absent'}]) {
  mode=scenario.mode||'success';calls=0;await cdp('Profiler.start');const started=performance.now();let response;
  for(let i=0;i<scenario.repeats;i++) {
   response=await(await mf.dispatchFetch('http://worker.test/?count='+scenario.count)).json();
   assert.equal(response.deleted,Math.min(5,scenario.count));assert.equal(response.pending,scenario.count>5);
  }
  const wallMs=performance.now()-started,{profile}=await cdp('Profiler.stop');
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),frames=new Map();let activeUs=0;
  for(let i=0;i<(profile.samples||[]).length;i++) {const frame=nodes.get(profile.samples[i])?.callFrame,us=profile.timeDeltas[i]||0;if(!frame||['(idle)','(program)','(root)'].includes(frame.functionName))continue;activeUs+=us;const name=frame.functionName||'(anonymous)';frames.set(name,(frames.get(name)||0)+us);}
  const fetches=calls/scenario.repeats;assert.equal(fetches,scenario.count===0?0:mode==='absent'?7:2);
  const row={scenario:scenario.name,requests:scenario.repeats,wallMsPerInvocation:wallMs/scenario.repeats,sampledActiveMsPerInvocation:activeUs/1000/scenario.repeats,
   storageFetchesPerInvocation:fetches,dbStatementsPerInvocation:response.queries,transactionsPerInvocation:response.transactions,
   topFrames:[...frames].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,us])=>({name,sampledMs:us/1000}))};
  results.push(row);console.log(JSON.stringify(row));await writeFile(resolve(output,scenario.name+'.cpuprofile'),JSON.stringify(profile));
 }
 await writeFile(resolve(output,'summary.json'),JSON.stringify({runtime:'local workerd',caveat:'V8 sampling estimate, not production billed CPU. Real cleanup/storage code; PostgreSQL/TLS mocked. Fetches counted, no external network.',results},null,2));
} finally {socket?.close();await mf.dispose();}
