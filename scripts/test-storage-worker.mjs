import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
// Resolve the runtime used by this project's Wrangler, not another global version.
const {Miniflare,NoOpLog}=require(require.resolve('miniflare',{paths:[require.resolve('wrangler/package.json')]}));
const compile=path=>ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
// Concatenated library modules are not Worker entrypoint exports. In particular,
// constants must not be interpreted by workerd as named service entrypoints.
const source=['lib/send-diagnostics.ts','lib/attachment-storage.ts','lib/gmail.ts','lib/delivery-policy.ts','lib/delivery-parser.ts','lib/gmail-delivery-client.ts']
  .map(path=>compile(path).replace(/^import .*from "\.\/[^"\r\n]+";\r?\n/gm,'').replace(/^export /gm,'')).join('\n');

test('workerd: actual storage and OAuth implementations work and never follow credential redirects',async()=>{
 const pending=[];
 let leaked=0;
 // Return raw responses at the outbound boundary. Miniflare's fetchMock uses
 // Node fetch internally, which can follow redirects before workerd sees them.
 const reply=(origin,path,status,data='',method='GET')=>pending.push({origin,path,status,data,method});
 const outboundService=async request=>{
  const url=new URL(request.url);
  if(url.hostname==='leak.test'){leaked++;return new Response('unexpected');}
  const expected=pending.shift();
  assert.ok(expected,'unexpected outbound request');assert.equal(url.origin,expected.origin);assert.equal(url.pathname,expected.path);assert.equal(request.method,expected.method);
  return new Response(expected.data,{status:expected.status,headers:expected.status>=300&&expected.status<400?{location:'https://leak.test/stolen'}:{}});
 };
 const mf=new Miniflare({log:new NoOpLog(),modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],outboundService,
  bindings:{SUPABASE_URL:'https://storage.test',SUPABASE_SERVICE_ROLE_KEY:'private-storage-token',SUPABASE_ATTACHMENTS_BUCKET:'bucket',GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'private-client-secret'},
  script:source+`
export default {async fetch(request){
 const op=new URL(request.url).pathname;
 try {
  if(op==='/legacy'){
   try {new Request('https://storage.test',{redirect:'error'});return Response.json({legacyAccepted:true});}
   catch(error){return Response.json({legacyAccepted:false,code:runtimeFailure(error)?.code});}
  }
  if(op==='/oauth'){await refreshAccessToken('private-refresh-token');return Response.json({refreshed:true});}
  if(op==='/delivery-list'){return Response.json(await listDeliveryCandidates('private-access-token',0,10000));}
  if(op==='/put'){await attachmentStorage().put('file',new Blob(['ok']));return Response.json({stored:true});}
  if(op==='/remove'){await attachmentStorage().remove('file');return Response.json({removed:true});}
  const bytes=await attachmentStorage().get('file');return Response.json({size:bytes.byteLength});
 }catch(error){return Response.json({code:error.code||'OPERATION_REJECTED',providerStatus:error.providerStatus??error.httpStatus});}
}}
`});
 const call=async path=>{const response=await mf.dispatchFetch('http://worker.test'+path);const text=await response.text();assert.ok(!text.includes('private-'));return JSON.parse(text);};
 try{
  assert.deepEqual(await call('/legacy'),{legacyAccepted:false,code:'FETCH_REDIRECT_MODE_UNSUPPORTED'});
  reply('https://storage.test','/storage/v1/object/authenticated/bucket/file',200,'ok');
  assert.deepEqual(await call('/get'),{size:2});
  for(const status of [301,302,303,307,308]){
   reply('https://storage.test','/storage/v1/object/authenticated/bucket/file',status);
   assert.deepEqual(await call('/get'),{code:'STORAGE_REDIRECT_REJECTED',providerStatus:status});
  }
  reply('https://storage.test','/storage/v1/object/bucket/file',307,'','POST');
  assert.equal((await call('/put')).code,'OPERATION_REJECTED');
  reply('https://storage.test','/storage/v1/object/bucket',307,'','DELETE');
  assert.equal((await call('/remove')).code,'OPERATION_REJECTED');
  reply('https://oauth2.googleapis.com','/token',200,JSON.stringify({access_token:'private-access-token'}),'POST');
  assert.deepEqual(await call('/oauth'),{refreshed:true});
  for(const status of [302,307]){
   reply('https://oauth2.googleapis.com','/token',status,'','POST');
   assert.deepEqual(await call('/oauth'),{code:'GMAIL_OAUTH_CONFIGURATION',providerStatus:status});
  }
  reply('https://gmail.googleapis.com','/gmail/v1/users/me/messages',200,JSON.stringify({messages:[{id:'bounce1'}]}));
  assert.deepEqual(await call('/delivery-list'),{ids:['bounce1'],nextPageToken:null});
  for(const [status,code] of [[302,'GMAIL_READ_FAILED'],[429,'GMAIL_RATE_LIMIT'],[500,'GMAIL_UNAVAILABLE'],[401,'GMAIL_REAUTH_REQUIRED'],[403,'GMAIL_READ_FORBIDDEN']]){
   reply('https://gmail.googleapis.com','/gmail/v1/users/me/messages',status);
   assert.equal((await call('/delivery-list')).code,code);
  }
  assert.equal(leaked,0,'No Authorization, apikey or OAuth POST body reaches a redirect destination');
  assert.equal(pending.length,0);
 }finally{await mf.dispose();}
});
