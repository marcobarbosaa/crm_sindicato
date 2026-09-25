import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ts from "typescript";
async function load(path) {
  const js=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
}
const {encodeRawEmail}=await load("../lib/gmail.ts");
const {validateAttachment,validateAttachmentSet,attachmentIds,ATTACHMENT_LIMITS}=await load("../lib/attachments.ts");
const base={from:"João da Associação <sender@example.com>",to:"recipient@example.com",subject:"Proposta para São Paulo — 日本語",body:"Olá, João!\nSegue a proposta.\nAtenciosamente, Associação."};
function parse(raw) {
  assert.match(raw,/^[A-Za-z0-9_-]+$/);
  const parser=[
    "import sys,json,base64",
    "from email import policy",
    "from email.parser import BytesParser",
    'm=BytesParser(policy=policy.default).parsebytes(base64.urlsafe_b64decode(sys.stdin.read()+"==="))',
    'print(json.dumps({"from":str(m["From"]),"to":str(m["To"]),"subject":str(m["Subject"]),"body":m.get_body(preferencelist=("plain",)).get_content(),"multipart":m.is_multipart(),"defects":[str(d) for part in m.walk() for d in part.defects],"files":[{"name":p.get_filename(),"type":p.get_content_type(),"disposition":p.get_content_disposition(),"content":base64.b64encode(p.get_payload(decode=True)).decode()} for p in m.iter_attachments()]}))',
  ].join("\n");
  const result=spawnSync("python",["-c",parser],{input:raw,encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
  return JSON.parse(result.stdout);
}
test("MIME sem anexos preserva remetente, assunto e corpo UTF-8",()=>{
  const result=parse(encodeRawEmail(base));
  assert.equal(result.multipart,false);assert.equal(result.body,base.body);
  assert.equal(result.subject,base.subject);assert.equal(result.from,base.from);assert.equal(result.to,base.to);assert.deepEqual(result.files,[]);assert.deepEqual(result.defects,[]);
});
test("MIME multipart recupera bytes exatos, nomes Unicode e nomes repetidos",()=>{
  const files=[
    {name:"proposta comercial São Paulo 日本語.pdf",mimeType:"application/pdf",content:Uint8Array.from([37,80,68,70,45,0,255,128,10])},
    {name:"proposta comercial São Paulo 日本語.pdf",mimeType:"application/pdf",content:Uint8Array.from([37,80,68,70,45,5,2,3])},
    {name:"apresentação "+"ç".repeat(70)+".pptx",mimeType:"application/vnd.openxmlformats-officedocument.presentationml.presentation",content:new Uint8Array(4000).map((_,i)=>i%256)},
  ];
  const result=parse(encodeRawEmail({...base,attachments:files}));
  assert.equal(result.multipart,true);assert.equal(result.body,base.body);assert.equal(result.subject,base.subject);assert.equal(result.files.length,3);
  result.files.forEach((file,i)=>{assert.equal(file.name,files[i].name);assert.equal(file.type,files[i].mimeType);assert.equal(file.disposition,"attachment");assert.equal(file.content,Buffer.from(files[i].content).toString("base64"));});
  assert.deepEqual(result.defects,[]);
});
test("cabeçalhos não aceitam injeção de CRLF",()=>{
  const raw=Buffer.from(encodeRawEmail({...base,subject:"Oi\r\nBcc: attacker@example.com"}),"base64url").toString("utf8");
  assert.doesNotMatch(raw,/\r\nBcc:/);
  assert.throws(()=>encodeRawEmail({...base,attachments:[{name:"x.pdf",mimeType:"application/pdf\r\nX-Evil: 1",content:new Uint8Array([1])}]}));
});
test("valida nome, extensão, MIME e tamanho no limite",()=>{
  assert.equal(validateAttachment({name:"Proposta São Paulo.pdf",type:"application/pdf",size:ATTACHMENT_LIMITS.fileBytes}).name,"Proposta São Paulo.pdf");
  for(const file of [
    {name:"../x.pdf",type:"application/pdf",size:1},{name:"x.exe",type:"application/pdf",size:1},
    {name:"x.pdf",type:"image/png",size:1},{name:"x.pdf",type:"application/pdf",size:0},
    {name:"x.pdf",type:"application/pdf",size:ATTACHMENT_LIMITS.fileBytes+1},
    {name:"x\r\n.pdf",type:"application/pdf",size:1},
  ])assert.throws(()=>validateAttachment(file));
});
test("valida total combinado, quantidade e IDs sem depender de nomes",()=>{
  assert.doesNotThrow(()=>validateAttachmentSet([{size:8*1024*1024},{size:3*1024*1024},{size:1*1024*1024}]));
  assert.throws(()=>validateAttachmentSet([{size:8*1024*1024},{size:3*1024*1024},{size:1*1024*1024+1}]));
  assert.throws(()=>validateAttachmentSet(Array.from({length:11},()=>({size:1}))));
  const id=crypto.randomUUID();assert.deepEqual(attachmentIds([id]),[id]);
  assert.throws(()=>attachmentIds([id,id]));assert.throws(()=>attachmentIds(["../../file"]));
});
