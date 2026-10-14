import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loader } from './smart-test-loader.mjs';
const originalFetch=globalThis.fetch;
let limit;
const {smartStorage,smartDeletionLimit}=loader({'./attachment-storage':{storageConfig:key=>({SUPABASE_URL:'https://synthetic.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic',SMART_SEND_BUCKET:'private',SMART_SEND_DELETE_FILES:limit})[key]}})('lib/smart-send-storage.ts');
const keys=Array.from({length:5},()=>`smart-sends/${crypto.randomUUID()}.pdf`);
afterEach(()=>{globalThis.fetch=originalFetch;limit=undefined;});

test('deletion limit is configurable from one to five, never unbounded',()=>{
  for(const [value,expected] of [[undefined,5],['1',1],['3',3],['5',5],['500',5],['0',5],['-1',5],['2.5',5],['invalid',5]]) {limit=value;assert.equal(smartDeletionLimit(),expected);}
});
test('five exact keys use one bucket check and one bulk DELETE',async()=>{
  const calls=[];
  globalThis.fetch=async(url,init)=>{
    calls.push({url,method:init.method}); assert.equal(init.redirect,'manual');
    if(url.includes('/bucket/')) return Response.json({public:false});
    assert.equal(url,'https://synthetic.test/storage/v1/object/private'); assert.equal(init.method,'DELETE');
    assert.deepEqual(JSON.parse(init.body),{prefixes:keys}); return Response.json(keys.map(name=>({name})));
  };
  assert.deepEqual(await smartStorage().removeMany(keys),keys); assert.equal(calls.length,2);
});
test('partial 2xx only confirms returned keys or explicit NoSuchKey metadata',async()=>{
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    calls++;
    if(url.includes('/bucket/'))return Response.json({public:false});
    if(init.method==='DELETE')return Response.json(keys.slice(0,2).map(name=>({name})));
    assert.match(url,/\/object\/info\/private\/smart-sends\//);
    if(url.endsWith(keys[2]))return Response.json({code:'NoSuchKey'},{status:404});
    if(url.endsWith(keys[3]))return Response.json({name:keys[3]});
    return Response.json({error:'unavailable'},{status:503});
  };
  assert.deepEqual(await smartStorage().removeMany(keys),keys.slice(0,3)); assert.equal(calls,5);
});
test('lost acknowledgement retry confirms five absent objects with at most seven fetches',async()=>{
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    calls++;
    if(url.includes('/bucket/'))return Response.json({public:false});
    if(init.method==='DELETE')return Response.json([]);
    return Response.json({error:'not_found',message:'Object not found'},{status:400});
  };
  assert.deepEqual(await smartStorage().removeMany(keys),keys); assert.equal(calls,7);
});
test('authentication, missing bucket, generic 404 and malformed metadata never prove absence',async()=>{
  for(const reply of [()=>Response.json({error:'NoSuchBucket'},{status:404}),()=>new Response('not found',{status:404}),()=>Response.json({code:'AccessDenied'},{status:403}),()=>Response.json({error:'not_found',message:'Bucket not found'},{status:400})]) {
    globalThis.fetch=async(url,init)=>url.includes('/bucket/')?Response.json({public:false}):init.method==='DELETE'?Response.json([]):reply();
    assert.deepEqual(await smartStorage().removeMany(keys),[]);
  }
});
test('invalid keys or oversized group issue no fetch; private bucket is required',async()=>{
  globalThis.fetch=()=>assert.fail('invalid input reached Storage');
  await assert.rejects(smartStorage().removeMany([...keys,'smart-sends/invalid.pdf']));
  await assert.rejects(smartStorage().removeMany([keys[0],'../other-owner.pdf']));
  globalThis.fetch=async()=>Response.json({public:true});
  await assert.rejects(smartStorage().removeMany(keys),/privado/);
});
test('DELETE failure, malformed or foreign-key receipt cannot discard metadata',async()=>{
  for(const reply of [()=>new Response(null,{status:503}),()=>Response.json({ok:true}),()=>Response.json([{name:'foreign/key.pdf'}]),()=>new Response('broken'),()=>{throw new DOMException('timeout','TimeoutError');}]) {
    globalThis.fetch=async url=>url.includes('/bucket/')?Response.json({public:false}):reply();
    await assert.rejects(smartStorage().removeMany(keys));
  }
});
