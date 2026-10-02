import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const code=new Map();
function fixture(options={}) {
 const logs=[],calls=[],cache=new Map();
 const scope='https://www.googleapis.com/auth/gmail.send';
 const state={crmSettings:[],emailMessages:[],emailAccounts:[{id:1,ownerId:'local-preview-user',provider:'GMAIL',email:'sender@example.test',scopes:scope,encryptedRefreshToken:'encrypted',needsReconnect:options.needsReconnect||false}],companies:[],emailTemplates:options.template?[{id:1,ownerId:"local-preview-user"}]:[],activityLogs:[],templateAttachments:options.rows||[],oauthStates:[{state:'state',ownerId:'local-preview-user',expiresAt:new Date(Date.now()+60000)}]};
 const schema=Object.fromEntries(Object.keys(state).map(t=>[t,new Proxy({table:t},{get:(o,k)=>k==='table'?t:k})]));
 class Query {
  constructor(kind,table,projection){Object.assign(this,{kind,table,projection});}
  from(t){this.table=t;return this;} where(p){this.p=p;return this;} orderBy(){return this;} limit(){return this;} for(){return this;} returning(){return this;}
  values(data){this.data=data;return this;} set(data){this.data=data;return this;}
  then(resolve,reject){return Promise.resolve().then(()=>{
   const t=this.table.table;calls.push(this.kind+':'+t);
   if(options.databaseFailure===t)throw Object.assign(new Error('private-db-password'),{code:'42P01'});
   let rows=state[t].filter(r=>!this.p||this.p(r));
   if(this.kind==='insert'){const r={id:state[t].length+1,...this.data};state[t].push(r);return [r];}
   if(this.kind==='update'){if(options.persistFailure&&t==='emailMessages'&&this.data.status==='SENT')throw new Error('private-db-password');rows.forEach(r=>Object.assign(r,this.data));}
   if(this.kind==='delete')state[t]=state[t].filter(r=>!rows.includes(r));
   if(this.projection?.total)return [{total:0}];
   return rows;
  }).then(resolve,reject);}
 }
 const db={select:p=>new Query('select',null,p),insert:t=>new Query('insert',t),update:t=>new Query('update',t),delete:t=>new Query('delete',t),transaction:async cb=>{calls.push('transaction');if(options.transactionFailure)throw Object.assign(new Error('private-db-password'),{code:'CONNECT_TIMEOUT'});return cb(db);}};
 const orm={eq:(a,b)=>r=>r[a]===b,and:(...p)=>r=>p.every(f=>f(r)),gt:()=>()=>true,gte:()=>()=>true,desc:x=>x,asc:x=>x,inArray:(k,vs)=>r=>vs.includes(r[k]),sql:()=>0};
 const fetch=async(url,init)=>{
  calls.push(url);
  assert.equal(init?.redirect,"manual","credential-bearing fetch must not follow redirects");
  if(url.includes('oauth2.googleapis.com/tokeninfo'))return Response.json({scope});
  if(url.includes('oauth2.googleapis.com/token')){
   if(init.body.get('grant_type')==='authorization_code')return Response.json({access_token:'private-access-token',scope,...(options.noRefresh?{}:{refresh_token:'private-new-refresh'})});
   if(options.oauthError)return Response.json({error:options.oauthError,error_description:'private-client-secret private-refresh-token'},{status:400});
   return Response.json({access_token:'private-access-token'});
  }
  if(url.includes('userinfo'))return Response.json({email:'sender@example.test'});
  if(url.includes('/storage/'))return options.storageStatus?new Response('private-storage-secret',{status:options.storageStatus}):new Response(new Uint8Array([1,2]));
  if(url.includes('gmail.googleapis.com'))return Response.json(options.gmailStatus?{error:{message:'private-provider-content'}}:{id:'gmail-id'},{status:options.gmailStatus||200});
  assert.fail('unexpected fetch');
 };
 function load(path){
  if(cache.has(path))return cache.get(path);
  if(!code.has(path))code.set(path,ts.transpileModule(readFileSync(new URL('../'+path+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
  const m={exports:{}};cache.set(path,m.exports);
  const require=name=>name==='next/server'?{NextResponse:{json:(data,init)=>Response.json(data,init),redirect:url=>new Response(null,{status:307,headers:{location:String(url)}})}}:name==='drizzle-orm'?orm:name==='@/db'?{getDb:()=>db}:name==='@/db/schema'?schema:name==='cloudflare:workers'?{env:options.noStorage?{}:{SUPABASE_URL:'https://storage.test',SUPABASE_SERVICE_ROLE_KEY:'private-storage-secret',SUPABASE_ATTACHMENTS_BUCKET:'bucket'}}:name==='@/lib/settings'?{sendingDayWindow:()=>({start:new Date(0)})}:load(name.startsWith('@/')?name.slice(2):'lib/'+name.replace('./',''));
  new Function('module','exports','require','fetch','process','console',code.get(path))(m,m.exports,require,fetch,{env:{GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'private-client-secret',TOKEN_ENCRYPTION_KEY:'private-encryption-key'}},{info:x=>logs.push(x),error:x=>logs.push(x)});
  return m.exports;
 }
 return {load,state,calls,logs,async send(input={}){
  const gmail=load('lib/gmail');state.emailAccounts[0].encryptedRefreshToken=await gmail.encryptToken('private-old-refresh');
  return load('app/api/emails/route').POST(new Request('https://app.test/api/emails',{method:'POST',body:JSON.stringify({recipient:'recipient@example.test',subject:'private-subject',body:'private-body',...input})}));
 },callback:()=>load('app/api/gmail/callback/route').GET(new Request('https://app.test/api/gmail/callback?state=state&code=private-code'))};
}
const row=()=>({id:'00000000-0000-4000-8000-000000000001',ownerId:'local-preview-user',templateId:null,ready:true,expiresAt:new Date(Date.now()+60000),size:2,name:'private-file.txt',mimeType:'text/plain',storageKey:'private-key'});
test('individual without attachments skips transaction, refreshes and sends',async()=>{const f=fixture();assert.equal((await f.send()).status,200);assert.ok(!f.calls.includes('transaction'));assert.equal(f.state.emailMessages[0].status,'SENT');assert.ok(f.logs.some(x=>JSON.parse(x).stage==='oauth-refresh'));});
test('individual attachments uses locked metadata and storage before Gmail',async()=>{const f=fixture({rows:[row()]});assert.equal((await f.send({attachmentIds:[row().id]})).status,200);assert.equal(f.state.emailMessages[0].attachments.length,1);assert.ok(f.calls.findIndex(x=>x.includes('/storage/'))<f.calls.findIndex(x=>x.includes('gmail.googleapis.com')));});
for(const status of [403,404,429,503])test('attachment storage '+status+' prevents OAuth and Gmail',async()=>{const f=fixture({rows:[row()],storageStatus:status});const r=await f.send({attachmentIds:[row().id]});assert.equal(r.status,503);const data=await r.json();assert.equal(data.stage,'attachments');assert.equal(data.category,'ATTACHMENT_FAILURE');assert.ok(!f.calls.some(x=>x.includes('googleapis.com')));});
test('missing storage configuration is not classified as database',async()=>{const f=fixture({rows:[row()],noStorage:true});const r=await f.send({attachmentIds:[row().id]});assert.equal((await r.json()).errorCode,'STORAGE_CONFIGURATION');});
test('attachment transaction failure retains database code',async()=>{const f=fixture({transactionFailure:true});const r=await f.send({templateId:undefined,attachmentIds:[row().id]});const data=await r.json();assert.equal(data.category,'DATABASE_FAILURE');assert.equal(data.errorCode,'CONNECT_TIMEOUT');assert.ok(!f.calls.some(x=>x.includes('googleapis.com')));});
for(const error of ['invalid_grant','invalid_client','temporarily_unavailable'])test('OAuth '+error+' classified safely',async()=>{const f=fixture({oauthError:error});const data=await (await f.send()).json();assert.equal(data.category,error==='invalid_grant'?'OAUTH_REAUTH_REQUIRED':error==='invalid_client'?'OAUTH_CONFIGURATION':'OAUTH_TEMPORARY_FAILURE');assert.equal(f.state.emailAccounts[0].needsReconnect,error==='invalid_grant');assert.ok(!f.calls.some(x=>x.includes('gmail.googleapis.com')));assert.ok(!JSON.stringify(f.logs).includes('private-'));});
for(const status of [429,500,503,400,403])test('Gmail '+status+' classified without provider content',async()=>{const f=fixture({gmailStatus:status});const r=await f.send();assert.equal(r.status,502);const d=await r.json();assert.equal(d.errorCode,status===429?'GMAIL_RATE_LIMIT':status>=500?'GMAIL_TEMPORARY_FAILURE':'GMAIL_PERMANENT_FAILURE');assert.ok(!JSON.stringify(f.logs).includes('private-'));assert.ok(!JSON.stringify(d).includes('private-'));});
test('database failure after acceptance never marks FAILED',async()=>{const f=fixture({persistFailure:true});const d=await (await f.send()).json();assert.equal(d.gmailAccepted,true);assert.equal(d.stage,'persist-result');assert.equal(d.category,'DATABASE_FAILURE');assert.notEqual(f.state.emailMessages[0].status,'FAILED');});
test('known invalid token blocks refresh and Gmail',async()=>{const f=fixture({needsReconnect:true});assert.equal((await f.send()).status,409);assert.ok(!f.calls.some(x=>x.includes('googleapis.com')));});
test('new refresh token is tested, encrypted, persisted and clears reconnect',async()=>{const f=fixture({needsReconnect:true});const r=await f.callback();assert.match(r.headers.get('location'),/gmail=connected/);assert.equal(f.state.emailAccounts[0].needsReconnect,false);assert.equal(await f.load('lib/gmail').decryptToken(f.state.emailAccounts[0].encryptedRefreshToken),'private-new-refresh');assert.ok(!JSON.stringify(f.logs).includes('private-'));});
test('no new refresh token never reports connected or reuses old authorization',async()=>{const f=fixture({noRefresh:true,needsReconnect:true});const r=await f.callback();assert.match(r.headers.get('location'),/gmail=error/);assert.equal(f.state.emailAccounts[0].encryptedRefreshToken,'encrypted');assert.equal(f.state.emailAccounts[0].needsReconnect,true);});
test('invalid new refresh token cannot replace the old invalid token',async()=>{const f=fixture({oauthError:'invalid_grant',needsReconnect:true});assert.match((await f.callback()).headers.get('location'),/gmail=error/);assert.equal(f.state.emailAccounts[0].needsReconnect,true);});
test('callback state is single use',async()=>{const f=fixture();await f.callback();assert.match((await f.callback()).headers.get('location'),/gmail=invalid-state/);});
test('connect keeps official offline consent parameters and original scope',async()=>{const f=fixture({needsReconnect:true});const r=await f.load('app/api/gmail/connect/route').GET(new Request('https://app.test/api/gmail/connect'));const u=new URL(r.headers.get('location'));assert.equal(u.searchParams.get('access_type'),'offline');assert.equal(u.searchParams.get('prompt'),'consent');assert.equal(u.searchParams.get('redirect_uri'),'https://app.test/api/gmail/callback');assert.equal(u.searchParams.get('scope'),'openid email https://www.googleapis.com/auth/gmail.send');assert.ok(u.searchParams.get('state'));});
test('success logs never contain tokens, email content, attachment names or credentials',async()=>{const f=fixture({rows:[row()]});await f.send({attachmentIds:[row().id]});assert.ok(!JSON.stringify(f.logs).includes('private-'));assert.ok(!JSON.stringify(f.logs).includes('example.test'));});

test('template attachments are resolved when attachmentIds is omitted',async()=>{const file={...row(),templateId:1};const f=fixture({template:true,rows:[file]});assert.equal((await f.send({templateId:1})).status,200);assert.equal(f.state.emailMessages[0].attachments.length,1);assert.ok(f.calls.includes('transaction'));});
test('explicit empty attachments overrides template and skips storage and transaction',async()=>{const f=fixture({template:true,rows:[{...row(),templateId:1}]});assert.equal((await f.send({templateId:1,attachmentIds:[]})).status,200);assert.ok(!f.calls.includes('transaction'));});
test('invalid attachment selection fails before OAuth',async()=>{const f=fixture();const r=await f.send({attachmentIds:['invalid-private-id']});assert.equal(r.status,400);assert.ok(!f.calls.some(x=>x.includes('googleapis.com')));assert.ok(!JSON.stringify(f.logs).includes('private-'));});
test('missing refresh token marks even a previously unmarked account for reconnect',async()=>{const f=fixture({noRefresh:true});await f.callback();assert.equal(f.state.emailAccounts[0].needsReconnect,true);assert.ok(!JSON.stringify(f.logs).includes('private-'));});

test('numeric template IDs from JSON are normalized safely',async()=>{const f=fixture({template:true,rows:[{...row(),templateId:1}]});assert.equal((await f.send({templateId:'1'})).status,200);});

test('database and Worker codes survive safely without free-form error text',()=>{const f=fixture();const {databaseFailure}=f.load('lib/send-diagnostics');assert.equal(databaseFailure({cause:Object.assign(new Error('private-password'),{code:'42P01'})}).code,'42P01');assert.equal(databaseFailure(new Error('Too many subrequests private-secret')).code,'CLOUDFLARE_SUBREQUEST_LIMIT');assert.ok(!JSON.stringify(databaseFailure(new Error('private-secret'))).includes('private-'));});

test('storage redirect is rejected with a precise safe code before OAuth',async()=>{const f=fixture({rows:[row()],storageStatus:302});const d=await(await f.send({attachmentIds:[row().id]})).json();assert.equal(d.errorCode,'STORAGE_REDIRECT_REJECTED');assert.ok(!f.calls.some(x=>x.includes('googleapis.com')));});
test('Gmail redirect is rejected without following its destination',async()=>{const f=fixture({gmailStatus:307});const d=await(await f.send()).json();assert.equal(d.errorCode,'GMAIL_REDIRECT_REJECTED');assert.ok(!JSON.stringify(f.logs).includes('private-'));});
