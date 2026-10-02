import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../lib/gmail.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(fetch, env={GOOGLE_CLIENT_ID:'client-placeholder',GOOGLE_CLIENT_SECRET:'private-client-secret'}){
 const loadedModule={exports:{}};
 new Function('module','exports','fetch','process',compiled)(loadedModule,loadedModule.exports,fetch,{env});
 return loadedModule.exports;
}
const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
test('OAuth invalid_grant reports reconnection without exposing provider text',async()=>{
 const {refreshAccessToken,GmailOAuthError}=load(async()=>response(400,{error:'invalid_grant',error_description:'private-refresh-token private-client-secret'}));
 await assert.rejects(refreshAccessToken('private-refresh-token'),e=>{
  assert.ok(e instanceof GmailOAuthError);assert.equal(e.code,'GMAIL_REAUTH_REQUIRED');assert.equal(e.httpStatus,400);assert.equal(e.requiresReconnect,true);
  assert.match(e.message,/Reconecte/);assert.equal((e.message+JSON.stringify(e)).includes('private-'),false);return true;
 });
});
test('OAuth success returns token with redirects disabled',async()=>{
 const {refreshAccessToken}=load(async(url,init)=>{assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(init.redirect,'manual');assert.equal(init.body.get('grant_type'),'refresh_token');return response(200,{access_token:'access'});});
 assert.equal(await refreshAccessToken('refresh'),'access');
});
test('OAuth invalid_client is configuration failure',async()=>{
 const {refreshAccessToken}=load(async()=>response(401,{error:'invalid_client'}));
 await assert.rejects(refreshAccessToken('refresh'),e=>e.code==='GMAIL_OAUTH_CONFIGURATION'&&e.requiresUserAction&&!e.requiresReconnect);
});
test('OAuth 503 stays retryable',async()=>{
 const {refreshAccessToken}=load(async()=>response(503,{error:'temporarily_unavailable'}));
 await assert.rejects(refreshAccessToken('refresh'),e=>e.code==='GMAIL_OAUTH_UNAVAILABLE'&&!e.requiresUserAction);
});
test('malformed OAuth response has safe diagnostics',async()=>{
 const {refreshAccessToken}=load(async()=>({ok:false,status:502,json:async()=>{throw Error('private response');}}));
 await assert.rejects(refreshAccessToken('refresh'),e=>e.code==='GMAIL_OAUTH_UNAVAILABLE'&&e.httpStatus===502&&!e.message.includes('private'));
});
test('unknown OAuth error strings cannot leak through diagnostics',async()=>{
 const {refreshAccessToken}=load(async()=>response(400,{error:'private-client-secret'}));
 await assert.rejects(refreshAccessToken('refresh'),e=>e.oauthCode==='unknown_error'&&!JSON.stringify(e).includes('private'));
});
test('missing configuration fails before network',async()=>{
 const {refreshAccessToken}=load(()=>assert.fail('must not call Google'),{});
 await assert.rejects(refreshAccessToken('refresh'),e=>e.code==='GMAIL_OAUTH_CONFIGURATION'&&e.oauthCode==='missing_configuration');
});
test('missing access token on success cannot be mistaken for valid authorization',async()=>{
 const {refreshAccessToken}=load(async()=>response(200,{access_token:123}));
 await assert.rejects(refreshAccessToken('refresh'),e=>e.code==='GMAIL_OAUTH_UNAVAILABLE');
});

test('OAuth rejects redirects without parsing provider content',async()=>{
 const {refreshAccessToken}=load(async()=>({ok:false,status:302,json:()=>assert.fail('redirect body must not be read')}));
 await assert.rejects(refreshAccessToken('private-refresh-token'),e=>e.oauthCode==='redirect_not_allowed'&&e.code==='GMAIL_OAUTH_CONFIGURATION');
});
