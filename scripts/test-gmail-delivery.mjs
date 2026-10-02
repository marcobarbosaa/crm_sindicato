import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const compiled = new Map();
const NOW = Date.now();
const owner = 'local-preview-user';
const scopes = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';
const ref = '<original@campaign.prospecta.invalid>';
function dsn(status = '5.1.1', diagnostic = 'smtp; 550 user unknown', reference = ref, email = 'old@example.test') {
  return `From: Mail Delivery Subsystem <mailer-daemon@example.test>\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="dsn"\r\n${reference ? 'In-Reply-To: '+reference+'\r\n' : ''}\r\n--dsn\r\nContent-Type: text/html\r\n\r\n<script>globalThis.hostile = true</script> unrelated@other.test\r\n--dsn\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; mail.example.test\r\n\r\nFinal-Recipient: rfc822; ${email}\r\nAction: failed\r\nStatus: ${status}\r\nDiagnostic-Code: ${diagnostic}\r\n\r\n--dsn--\r\n`;
}

// Execute production modules against a relational adapter. Transactions serialize
// and roll back; unique indexes and joins are modeled, Google remains mocked.
function fixture(options = {}) {
  const names = ['companies', 'contacts', 'emailAccounts', 'emailCampaigns', 'emailCampaignRecipients', 'emailMessages', 'gmailDeliverySyncState', 'emailDeliveryEvents', 'activityLogs'];
  let state = Object.fromEntries(names.map(name => [name, []]));
  const schema = Object.fromEntries(names.map(table => [table, new Proxy({ table }, { get: (t, key) => key === 'table' ? t.table : { table, column: key } })]));
  state.companies = [{ id: 1, ownerId: owner, primaryEmail: ' OLD@example.test ', primaryEmailStatus: 'UNKNOWN', name: '=HYPERLINK("hostile")', cnpj: '123', city: 'Recife', region: 1 }];
  state.emailCampaigns = [{ id: 1, ownerId: owner, status: 'COMPLETED', deliveryMonitoringEnabled: true, startedAt: new Date(NOW - 3600000), completedAt: new Date(NOW - 1800000), createdAt: new Date(NOW - 7200000), deliveryNextCheckAt: null, deliveryCompletedAt: null, deliveryCheckedAt: null }];
  state.emailAccounts = [{ id: 1, ownerId: owner, provider: 'GMAIL', email: 'sender@example.test', scopes, needsReconnect: false, updatedAt: new Date(NOW - 7200000), connectedAt: new Date(NOW - 7200000) }];
  state.emailMessages = [{ id: 1, ownerId: owner, campaignId: 1, recipient: 'old@example.test', status: 'SENT', sentAt: new Date(NOW - 3000000), rfcMessageId: ref, providerMessageId: 'sent1', emailAccountId: 1, senderAddress: 'sender@example.test' }];
  state.emailCampaignRecipients = [{ id: 1, campaignId: 1, companyId: 1, companyName: '=HYPERLINK("hostile")', recipient: 'old@example.test', messageId: 1, status: 'SENT', sentAt: new Date(NOW - 3000000), deliveryStatus: 'PENDING', bouncedAt: null }];
  const logs = [], requests = [], cache = new Map();
  const value = (v, ctx) => v?.column ? ctx[v.table]?.[v.column] : v;
  const sqlValue = (s, ctx) => {
    const source = s.parts.join('');
    if (source.includes('count(*)')) return { count: true };
    if (source.includes('select c.id')) return state.contacts.filter(c=>c.companyId===ctx.companies.id&&c.isPrimary&&c.email?.trim()).sort((a,b)=>a.id-b.id)[0]?.id;
    if (source.startsWith('coalesce(nullif(lower')) return String(value(s.values[0],ctx)||'').trim().toLowerCase()||String(value(s.values[1],ctx)||'').trim().toLowerCase()||null;
    if (source.includes("= 'INVALID' and")) return value(s.values[0],ctx)==='INVALID'&&sqlValue(s.values[1],ctx)===String(value(s.values[2],ctx)||'').trim().toLowerCase();
    if (source.includes('exists')) {
      if(s.values.some(v=>v?.table==='emailMessages'))return state.emailMessages.some(m=>m.id===ctx.emailCampaignRecipients.messageId&&m.ownerId===owner&&m.emailAccountId===state.emailAccounts[0].id&&m.senderAddress===state.emailAccounts[0].email);
      const id = s.values.find(v => typeof v === 'number'), own = s.values.find(v => typeof v === 'string');
      return state.emailCampaigns.some(c => c.id === id && c.ownerId === own);
    }
    if (source.includes('lower(btrim')) return String(value(s.values[0], ctx) || '').trim().toLowerCase() === s.values.at(-1);
    throw Error('Unmodeled SQL: '+source);
  };
  const predicate = (p, ctx) => !p || (typeof p === 'function' ? p(ctx) : sqlValue(p, ctx));
  const comparable = (v,ctx) => v?.parts ? sqlValue(v,ctx) : v instanceof Date ? +v : v;
  const op = fn => (a, b) => ctx => fn(comparable(value(a, ctx),ctx), comparable(value(b, ctx),ctx));
  const orm = { eq: op((a,b)=>a===b), ne: op((a,b)=>a!==b), gt: op((a,b)=>a!=null&&a>b), gte: op((a,b)=>a!=null&&a>=b), lte: op((a,b)=>a!=null&&a<=b),
    and: (...ps)=>ctx=>ps.every(p=>predicate(p,ctx)), or: (...ps)=>ctx=>ps.filter(Boolean).some(p=>predicate(p,ctx)),
    isNull: col=>ctx=>value(col,ctx)==null, inArray: (col, values)=>ctx=>values.includes(value(col,ctx)), asc: col=>col,
    count:()=>({parts:['count(*)'],values:[]}),sql: (parts,...values)=>({parts,values}) };
  class Query {
    constructor(kind, table, projection) { Object.assign(this,{kind,table,projection,joins:[],take:Infinity}); }
    from(t){this.table=t;return this;} where(p){this.p=p;return this;} set(d){this.data=d;return this;} values(d){this.data=d;return this;}
    limit(n){this.take=n;return this;} orderBy(...c){this.order=c;return this;} groupBy(...c){this.groups=c;return this;}
    innerJoin(t,p){this.joins.push({t,p});return this;} leftJoin(t,p){this.joins.push({t,p,left:true});return this;}
    onConflictDoNothing(){this.ignore=true;return this;} returning(projection){this.projection=projection;return this;} for(){return this;}
    then(resolve,reject){return Promise.resolve().then(()=>this.execute()).then(resolve,reject);}
    execute(){
      const table=this.table.table;
      if(this.kind==='insert'){
        if(table==='emailDeliveryEvents'&&options.eventFailure)throw Error('private db details');
        const conflict=state[table].find(row=>table==='gmailDeliverySyncState'?row.campaignId===this.data.campaignId:table==='emailDeliveryEvents'?row.ownerId===this.data.ownerId&&row.gmailMessageId===this.data.gmailMessageId&&row.recipient===this.data.recipient:false);
        if(conflict&&this.ignore)return [];
        if(conflict)throw Error('unique violation');
        const data=Array.isArray(this.data)?this.data:[this.data];const rows=data.map((row,i)=>({id:state[table].length+i+1,...row}));state[table].push(...rows);return structuredClone(rows);
      }
      let contexts=state[table].map(row=>({[table]:row}));
      for(const j of this.joins) contexts=contexts.flatMap(ctx=>{const matches=state[j.t.table].filter(row=>predicate(j.p,{...ctx,[j.t.table]:row}));return matches.length?matches.map(row=>({...ctx,[j.t.table]:row})):j.left?[{...ctx,[j.t.table]:null}]:[];});
      contexts=contexts.filter(ctx=>predicate(this.p,ctx));
      if(this.order)contexts.sort((a,b)=>{for(const col of this.order){const x=comparable(value(col,a)),y=comparable(value(col,b));if(x>y)return 1;if(x<y)return -1;}return 0;});
      contexts=contexts.slice(0,this.take);
      if(this.kind==='update')contexts.forEach(ctx=>Object.assign(ctx[table],this.data));
      if(this.kind==='delete'){state[table]=state[table].filter(row=>!contexts.some(ctx=>ctx[table]===row));return [];}
      const aggregate=col=>{
        const source=col.parts.join('');if(!source.includes('filter'))return contexts.length;
        return contexts.filter(ctx=>{const recipient=sqlValue(col.values[0],ctx);if(source.includes('is null)'))return recipient===null;const invalid=sqlValue(col.values[1],ctx);return recipient!==null&&(source.includes('and not')?!invalid:invalid);}).length;
      };
      const project=(ctx,total)=>this.projection?Object.fromEntries(Object.entries(this.projection).map(([k,col])=>[k,Array.isArray(col.parts)?col.parts.join('').includes('count(*)')?total??aggregate(col):sqlValue(col,ctx):typeof col.column==='string'?value(col,ctx):ctx[col.table]])):ctx[table];
      if(this.groups){const groups=new Map();for(const ctx of contexts){const key=JSON.stringify(this.groups.map(c=>value(c,ctx)));groups.set(key,[...(groups.get(key)||[]),ctx]);}return structuredClone([...groups.values()].map(g=>project(g[0],g.length)));}
      if(this.projection&&Object.values(this.projection).some(col=>Array.isArray(col.parts)&&col.parts.join('').includes('count(*)')))return [project(contexts[0]||{})];
      return structuredClone(contexts.map(ctx=>project(ctx)));
    }
  }
  let transactionTail=Promise.resolve();
  const db={select:p=>new Query('select',null,p),update:t=>new Query('update',t),insert:t=>new Query('insert',t),delete:t=>new Query('delete',t),
    transaction:fn=>{const work=transactionTail.then(async()=>{const snapshot=structuredClone(state);try{return await fn(db);}catch(e){state=snapshot;throw e;}});transactionTail=work.catch(()=>{});return work;}};
  const fetch=async(url,init)=>{
    requests.push({url,init}); assert.equal(init.redirect,'manual');assert.ok(init.signal);
    if(url.includes('oauth2.googleapis.com'))return options.oauthError?Response.json({error:options.oauthError,error_description:'private token'},{status:400}):Response.json({access_token:'private-token'});
    if(options.gmailStatus)return Response.json({error:'private response'},{status:options.gmailStatus});
    const u=new URL(url);
    if(u.pathname.endsWith('/messages')){
      if(options.malformedList)return Response.json('not-a-message-list');
      if(u.searchParams.get('q').includes('rfc822msgid'))return Response.json({messages:[{id:'sent1'}]});
      assert.equal(u.searchParams.get('maxResults'),'1'); assert.match(u.searchParams.get('q'),/after:\d+ before:\d+/);
      return Response.json(options.noBounce?{}:{messages:[{id:'bounce1'}],...(options.nextPage?{nextPageToken:'page2'}:{})});
    }
    return Response.json({id:'bounce1',threadId:'thread1',internalDate:String(NOW-10000),raw:Buffer.from(options.raw??dsn(options.status,options.diagnostic)).toString('base64url')});
  };
  function load(path){
    if(cache.has(path))return cache.get(path);
    if(!compiled.has(path))compiled.set(path,ts.transpileModule(readFileSync(new URL('../'+path+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
    const m={exports:{}};cache.set(path,m.exports);
    const require=name=>name==='@/lib/attachment-service'?{loadSendAttachments:async()=>[]}:name==='drizzle-orm'?orm:name==='@/db'?{getDb:()=>db,withCampaignDb:fn=>fn()}:name==='@/db/schema'?schema:name==='next/server'?{NextResponse:{json:(v,init)=>Response.json(v,init)}}:load(name.startsWith('@/')?name.slice(2):'lib/'+name.replace('./',''));
    new Function('module','exports','require','fetch','process','console',compiled.get(path))(m,m.exports,require,fetch,{env:{GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'private-secret',TOKEN_ENCRYPTION_KEY:'private-key'}},{info:v=>logs.push(v)});
    return m.exports;
  }
  const api={load,get state(){return state;},requests,logs,
    async run(){const account=state.emailAccounts[0];account.encryptedRefreshToken||=await load('lib/gmail').encryptToken('private-refresh');return load('lib/gmail-delivery').processPendingDeliveryChecks();},
    report:(id='1',query='')=>load('app/api/email-campaigns/[id]/delivery/route').GET({nextUrl:new URL('https://app.test/?'+query)},{params:Promise.resolve({id})}),
    async record(notice=load('lib/delivery-parser').parseDeliveryStatus(dsn()).notices[0], own=owner){return load('lib/gmail-delivery').recordDeliveryEvent(own,1,1,1,notice,{id:'bounce1',threadId:'thread1',receivedAt:NOW-10000});}
  };return api;
}

for(const [status,diagnostic,category,delivery,invalid] of [
  ['5.1.1','smtp; 550 user unknown','ADDRESS_NOT_FOUND','BOUNCED',true],
  ['5.1.2','smtp; 550 domain does not exist (NXDOMAIN)','DOMAIN_NOT_FOUND','BOUNCED',true],
  ['5.2.2','smtp; mailbox full','MAILBOX_FULL','MAILBOX_FULL',false],
  ['4.1.1','smtp; user unknown; try again later','TEMPORARY_SERVER_FAILURE','TEMPORARY_FAILURE',false],
  ['5.7.1','smtp; spam rejection','SPAM_REJECTED','BLOCKED',false],
  ['5.7.0','smtp; policy rejection','POLICY_REJECTION','BLOCKED',false],
  ['5.0.0','smtp; unknown error','UNKNOWN','UNKNOWN_FAILURE',false],
])test(`reconcile ${status} ${category} preserves SENT; invalid=${invalid}`,async()=>{
  const f=fixture({status,diagnostic});assert.equal((await f.run()).outcome,'checked');
  assert.equal(f.state.emailDeliveryEvents.length,1);assert.equal(f.state.emailDeliveryEvents[0].category,category);
  assert.equal(f.state.companies[0].primaryEmailStatus,invalid?'INVALID':'UNKNOWN');
  assert.equal(f.state.emailCampaignRecipients[0].deliveryStatus,delivery);assert.equal(f.state.emailCampaignRecipients[0].status,'SENT');assert.equal(f.state.emailMessages[0].status,'SENT');
  assert.equal(f.state.activityLogs.filter(r=>r.type==='EMAIL_ADDRESS_INVALIDATED').length,Number(invalid));
  assert.equal(f.requests.some(r=>r.url.includes('/send')),false);
});
test('duplicate bounce creates one event and one activity, including simultaneous transactions',async()=>{
  const f=fixture();const results=await Promise.all([f.record(),f.record()]);assert.equal(results.filter(Boolean).length,1);assert.equal(f.state.emailDeliveryEvents.length,1);assert.equal(f.state.activityLogs.length,1);
});
test('simultaneous crons lease a single scan; repeated scan remains idempotent',async()=>{
  const f=fixture();await Promise.all([f.run(),f.run()]);assert.equal(f.state.emailDeliveryEvents.length,1);assert.equal(f.state.activityLogs.length,1);
  f.state.emailCampaigns[0].deliveryNextCheckAt=null;await f.run();assert.equal(f.state.emailDeliveryEvents.length,1);
});
test('same recipient in two campaigns requires the exact reference',async()=>{
  const f=fixture();f.state.emailMessages.push({...f.state.emailMessages[0],id:2,campaignId:2,rfcMessageId:'<other@example.test>'});
  await f.run();assert.equal(f.state.emailDeliveryEvents[0].campaignId,1);
  const ambiguous=fixture({raw:dsn('5.1.1','user unknown','')});ambiguous.state.emailMessages.push({...ambiguous.state.emailMessages[0],id:2,campaignId:2,rfcMessageId:'<other@example.test>'});
  await ambiguous.run();assert.equal(ambiguous.state.emailDeliveryEvents.length,0);assert.equal(ambiguous.state.companies[0].primaryEmailStatus,'UNKNOWN');
});
test('reference to another campaign never falls back to recipient-only match',async()=>{
  const f=fixture({raw:dsn('5.1.1','user unknown','<other@example.test>')});f.state.emailMessages.push({...f.state.emailMessages[0],id:2,campaignId:2,rfcMessageId:'<other@example.test>'});
  await f.run();assert.equal(f.state.emailDeliveryEvents.length,0);
});
test('old bounce cannot invalidate a corrected primaryEmail',async()=>{const f=fixture();f.state.companies[0].primaryEmail='new@example.test';await f.run();assert.equal(f.state.companies[0].primaryEmailStatus,'UNKNOWN');assert.equal(f.state.emailDeliveryEvents.length,1);assert.equal(f.state.activityLogs.length,0);});
for(const status of [429,500,403,401,302])test(`Google ${status} never changes company or delivery result`,async()=>{
  const f=fixture({gmailStatus:status});await f.run();assert.equal(f.state.companies[0].primaryEmailStatus,'UNKNOWN');assert.equal(f.state.emailDeliveryEvents.length,0);assert.equal(f.state.emailCampaignRecipients[0].deliveryStatus,'PENDING');assert.equal(f.state.emailAccounts[0].needsReconnect,status===401);assert.ok(f.state.gmailDeliverySyncState[0].lastError);assert.equal(JSON.stringify(f.logs).includes('private'),false);
});
test('invalid_grant follows existing reconnect semantics',async()=>{const f=fixture({oauthError:'invalid_grant'});await f.run();assert.equal(f.state.emailAccounts[0].needsReconnect,true);assert.equal(f.state.emailDeliveryEvents.length,0);});
test('send-only account stays usable for send but status requires deliberate reconnection',async()=>{
  const f=fixture();f.state.emailAccounts[0].scopes='https://www.googleapis.com/auth/gmail.send';
  const status=await(await f.load('app/api/gmail/status/route').GET()).json();assert.equal(status.connected,true);assert.equal(status.needsReconnect,true);assert.equal(status.deliveryEnabled,false);
  await f.run();assert.equal(f.requests.length,0);assert.equal(f.state.emailAccounts[0].needsReconnect,false);assert.equal(f.state.gmailDeliverySyncState[0].lastError,'GMAIL_READ_SCOPE_MISSING');
});
test('complete scan without bounce records NO_KNOWN_FAILURE, never DELIVERED',async()=>{const f=fixture({noBounce:true});await f.run();assert.equal(f.state.emailCampaignRecipients[0].deliveryStatus,'NO_KNOWN_FAILURE');assert.equal(f.state.companies[0].primaryEmailStatus,'UNKNOWN');assert.equal(JSON.stringify(f.state).includes('DELIVERED'),false);});
test('HTML is ignored and arbitrary addresses in prose never correlate',async()=>{
  const f=fixture({raw:'From: postmaster@example.test\r\nContent-Type: text/html\r\n\r\n<script>globalThis.hostile=true</script>old@example.test 5.1.1 user unknown'});await f.run();assert.equal(f.state.emailDeliveryEvents.length,0);assert.equal(globalThis.hostile,undefined);
  const notice=f.load('lib/delivery-parser').parseDeliveryStatus(dsn('5.1.1','smtp; <img src=x onerror=alert(1)> user unknown\u0000')).notices[0];assert.ok(!notice.diagnostic.includes('<'));assert.ok(!notice.diagnostic.includes('\u0000'));
});
test('CSV escapes formula prefixes including whitespace; report never contains raw MIME',async()=>{
  const f=fixture();await f.run();const {csvCell}=f.load('lib/delivery-policy');for(const v of ['=1+1','+cmd','-cmd','@sum','\t=cmd'])assert.ok(csvCell(v).startsWith('"\''));
  const response=await f.report('1','format=csv');assert.equal(response.status,200);const csv=await response.text();assert.match(csv,/'=HYPERLINK/);assert.ok(!csv.includes('<script>'));assert.ok(!csv.includes('Content-Type:'));assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('owner mismatch returns 404 and cannot write delivery events or company state',async()=>{
  const f=fixture();f.state.emailCampaigns[0].ownerId='other-owner';assert.equal((await f.report()).status,404);assert.equal(await f.record(),false);assert.equal(f.state.emailDeliveryEvents.length,0);assert.equal(f.state.companies[0].primaryEmailStatus,'UNKNOWN');
});
test('transaction failure rolls back invalidation and event',async()=>{const f=fixture({eventFailure:true});await assert.rejects(f.record());assert.equal(f.state.emailDeliveryEvents.length,0);assert.equal(f.state.companies[0].primaryEmailStatus,'UNKNOWN');});
test('paginated mailbox scan holds bounds and does not mark absence until complete',async()=>{
  const opts={nextPage:true};const f=fixture(opts);await f.run();assert.equal(f.state.gmailDeliverySyncState[0].pageToken,'page2');const after=+f.state.gmailDeliverySyncState[0].scanAfter,before=+f.state.gmailDeliverySyncState[0].scanBefore;
  opts.nextPage=false;opts.noBounce=true;await f.run();const second=f.requests.filter(r=>r.url.includes('maxResults=1')).at(-1);assert.equal(new URL(second.url).searchParams.get('pageToken'),'page2');assert.equal(new URL(second.url).searchParams.get('q').includes('after:'+Math.floor(after/1000)+' before:'+Math.ceil(before/1000)),true);assert.equal(f.state.gmailDeliverySyncState[0].pageToken,null);
});
test('reconnecting a different mailbox cannot correlate using old account id alone',async()=>{const f=fixture();f.state.emailAccounts[0].email='different@example.test';await f.run();assert.equal(f.state.emailDeliveryEvents.length,0);});
test('oversized MIME is bounded and cannot imply successful analysis',async()=>{const f=fixture({raw:'x'.repeat(300000)});await f.run();assert.equal(f.state.emailCampaignRecipients[0].deliveryStatus,'PENDING');assert.equal(f.state.gmailDeliverySyncState[0].lastError,'PARTIAL_ANALYSIS');});
test('delayed DSN never invalidates even if it contains a permanent-looking code',async()=>{const f=fixture({raw:dsn().replace('Action: failed','Action: delayed')});await f.run();assert.equal(f.state.companies[0].primaryEmailStatus,'UNKNOWN');assert.equal(f.state.emailCampaignRecipients[0].deliveryStatus,'TEMPORARY_FAILURE');});
test('primary address restoration is owner-checked and rejects stale address review',async()=>{
  const f=fixture();await f.run();const route=f.load('app/api/companies/[id]/email-status/route');const invoke=email=>route.PATCH({json:async()=>({expectedEmail:email})},{params:Promise.resolve({id:'1'})});
  assert.equal((await invoke('different@example.test')).status,409);assert.equal((await invoke('old@example.test')).status,200);assert.equal(f.state.companies[0].primaryEmailStatus,'UNKNOWN');
  f.state.companies[0].ownerId='other';assert.equal((await invoke('old@example.test')).status,404);
});

test('preview and prepare separately count absent/invalid and keep full/blocked/temporary eligible',async()=>{
  const f=fixture();f.state.emailCampaigns[0].status='DRAFT';f.state.emailCampaigns[0].templateId=1;
  f.state.companies=[...['INVALID','MAILBOX_FULL','BLOCKED','TEMPORARY_FAILURE','UNKNOWN'].map((status,i)=>({id:i+1,ownerId:owner,name:'Company '+i,primaryEmail:`r${i}@example.test`,primaryEmailStatus:status})),{id:6,ownerId:owner,name:'Missing',primaryEmail:null,primaryEmailStatus:'UNKNOWN'}, {id:7,ownerId:'other',name:'Other owner',primaryEmail:'other@example.test',primaryEmailStatus:'UNKNOWN'}];
  const audience=await(await f.load('app/api/email-campaigns/audience/route').GET({nextUrl:new URL('https://app.test/')})).json();
  assert.equal(audience.total,6);assert.equal(audience.eligible,4);assert.equal(audience.invalidEmail,1);assert.equal(audience.withoutEmail,1);
  const prepared=await(await f.load('app/api/email-campaigns/[id]/prepare/route').POST({}, {params:Promise.resolve({id:'1'})})).json();
  assert.equal(prepared.eligible,4);assert.equal(prepared.invalidEmail,1);assert.equal(prepared.withoutEmail,1);assert.equal(f.state.emailCampaigns[0].audienceInvalidEmail,1);
  assert.ok(f.state.emailCampaignRecipients.every(r=>r.recipient!=='r0@example.test'&&r.recipient!=='other@example.test'));
});
test('different primary contact remains eligible and multiple primary contacts are deterministic',async()=>{
  const f=fixture();f.state.companies[0].primaryEmailStatus='INVALID';f.state.emailCampaigns[0].status='DRAFT';f.state.emailCampaigns[0].templateId=1;
  f.state.contacts=[{id:3,companyId:1,isPrimary:true,email:'third@example.test'},{id:2,companyId:1,isPrimary:true,email:'second@example.test'}];
  const audience=await(await f.load('app/api/email-campaigns/audience/route').GET({nextUrl:new URL('https://app.test/')})).json();assert.equal(audience.eligible,1);assert.equal(audience.invalidEmail,0);
  await f.load('app/api/email-campaigns/[id]/prepare/route').POST({}, {params:Promise.resolve({id:'1'})});assert.equal(f.state.emailCampaignRecipients.length,1);assert.equal(f.state.emailCampaignRecipients[0].recipient,'second@example.test');
});
test('RFC Message-ID injection is rejected; generated reference survives MIME encoding',()=>{
  const f=fixture(),{encodeRawEmail}=f.load('lib/gmail'),args={from:'sender@example.test',to:'recipient@example.test',subject:'Test',body:'Message'};
  assert.throws(()=>encodeRawEmail({...args,messageId:'<x@y>\r\nBcc: attacker@example.test'}));
  assert.match(Buffer.from(encodeRawEmail({...args,messageId:ref}),'base64url').toString(),/Message-ID: <original@campaign.prospecta.invalid>/);
});
test('final scan closes delivery window without changing COMPLETED; legacy campaigns are excluded',async()=>{
  const f=fixture({noBounce:true});f.state.emailCampaigns[0].completedAt=new Date(NOW-25*3600000);f.state.emailCampaigns[0].startedAt=new Date(NOW-26*3600000);await f.run();assert.ok(f.state.emailCampaigns[0].deliveryCompletedAt);assert.equal(f.state.emailCampaigns[0].status,'COMPLETED');
  const old=fixture();old.state.emailCampaigns[0].deliveryMonitoringEnabled=false;assert.equal((await old.run()).outcome,'idle');assert.equal(old.requests.length,0);
});
test('original message attachment headers and encoded DSN are parsed, embedded HTML is ignored',()=>{
  const f=fixture(),parser=f.load('lib/delivery-parser');
  let raw=dsn('5.1.1','user unknown','');raw=raw.replace('--dsn--','--dsn\r\nContent-Type: message/rfc822\r\n\r\nMessage-ID: '+ref+'\r\nContent-Type: text/html\r\n\r\n<script>hostile()</script>\r\n--dsn--');
  assert.deepEqual(parser.parseDeliveryStatus(raw).notices[0].originalMessageIds,[ref]);
  const body='Final-Recipient: rfc822; old@example.test\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; user unknown';
  const encoded='Content-Type: multipart/report; boundary="b"\r\n\r\n--b\r\nContent-Type: message/delivery-status\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from(body).toString('base64')+'\r\n--b--';
  assert.equal(parser.parseDeliveryStatus(encoded).notices[0].category,'ADDRESS_NOT_FOUND');
});
test('malformed successful Gmail response cannot count as absence of bounces',async()=>{const f=fixture({malformedList:true});await f.run();assert.equal(f.state.emailCampaignRecipients[0].deliveryStatus,'PENDING');assert.equal(f.state.gmailDeliverySyncState[0].lastError,'GMAIL_INVALID_RESPONSE');});
