import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, companies, contacts, crmSettings, emailAccounts, emailMessages, emailTemplates } from "@/db/schema";
import { decryptToken, encodeRawEmail, refreshAccessToken } from "@/lib/gmail";

const SEND_SCOPE="https://www.googleapis.com/auth/gmail.send";
const LIMIT=20;
const ownerId=(request:NextRequest)=>"local-preview-user";
const personalize=(value:string,data:Record<string,string>)=>value.replace(/{{\s*(empresa|contato|segmento|cidade|estado|email_empresa)\s*}}/g,(_,key:string)=>data[key]||"");

export async function POST(request:NextRequest){
 const db=getDb(),owner=ownerId(request),input=await request.json() as {companyIds?:number[];templateId?:number;confirmed?:boolean};
 const ids=[...new Set((input.companyIds||[]).map(Number).filter(Number.isInteger))];
 if(!input.confirmed)return NextResponse.json({error:"Confirme explicitamente o envio em lote."},{status:400});
 if(!ids.length)return NextResponse.json({error:"Selecione pelo menos uma empresa."},{status:400});
 if(ids.length>LIMIT)return NextResponse.json({error:`Selecione no máximo ${LIMIT} empresas por lote.`},{status:400});
 const [settings]=await db.select().from(crmSettings).where(eq(crmSettings.ownerId,owner)).limit(1);const startToday=new Date();startToday.setUTCHours(3,0,0,0);const [today]=await db.select({total:sql<number>`count(*)`}).from(emailMessages).where(and(eq(emailMessages.ownerId,owner),eq(emailMessages.status,"SENT"),gte(emailMessages.sentAt,sql`${startToday.getTime()}`)));const remaining=(settings?.dailySendLimit||100)-Number(today?.total||0);if(remaining<=0||ids.length>remaining)return NextResponse.json({error:`O lote ultrapassa seu limite diário. Restam ${Math.max(0,remaining)} envio(s) hoje.`},{status:429});
 const [account]=await db.select().from(emailAccounts).where(and(eq(emailAccounts.ownerId,owner),eq(emailAccounts.provider,"GMAIL"))).limit(1);
 if(!account||!account.scopes.split(/\s+/).includes(SEND_SCOPE))return NextResponse.json({error:"Conecte o Gmail com permissão de envio antes de continuar."},{status:409});
 if(settings?.senderName)account.email=`${settings.senderName.replace(/[\r\n<>]/g," ").trim()} <${account.email}>`;
 const [template]=await db.select().from(emailTemplates).where(and(eq(emailTemplates.id,Number(input.templateId)),eq(emailTemplates.ownerId,owner))).limit(1);
 if(!template)return NextResponse.json({error:"Selecione um template válido."},{status:400});
 const targets=await db.select().from(companies).where(and(eq(companies.ownerId,owner),inArray(companies.id,ids)));
 const accessToken=await refreshAccessToken(await decryptToken(account.encryptedRefreshToken));
 const results:{companyId:number;company:string;recipient:string;status:"SENT"|"FAILED"|"SKIPPED";error?:string}[]=[];
 for(const company of targets){
  const [primary]=await db.select().from(contacts).where(and(eq(contacts.companyId,company.id),eq(contacts.isPrimary,true))).limit(1);
  const recipient=(primary?.email||company.primaryEmail||"").trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)){results.push({companyId:company.id,company:company.name,recipient,status:"SKIPPED",error:"Empresa sem e-mail válido."});continue;}
  const data={empresa:company.name,contato:primary?.name||"",segmento:company.segment||"",cidade:company.city||"",estado:company.state||"",email_empresa:company.primaryEmail||""};
  const subject=personalize(template.subject,data),messageBody=personalize(template.body,data),body=settings?.signature?`${messageBody}\n\n${settings.signature}`:messageBody;
    const [duplicate]=await db.select({id:emailMessages.id}).from(emailMessages).where(and(eq(emailMessages.ownerId,owner),eq(emailMessages.recipient,recipient),eq(emailMessages.subject,subject),gte(emailMessages.createdAt,sql`${Date.now()-24*60*60_000}`))).limit(1);
  if(duplicate){results.push({companyId:company.id,company:company.name,recipient,status:"SKIPPED",error:"E-mail igual enviado nas últimas 24 horas."});continue;}
  const now=new Date(); const [message]=await db.insert(emailMessages).values({ownerId:owner,companyId:company.id,contactId:primary?.id||null,templateId:template.id,recipient,subject,body,status:"QUEUED",kind:"BATCH",createdAt:now}).returning();
  try{
   const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({raw:encodeRawEmail({from:account.email,to:recipient,subject,body})})});
   const sent=await response.json() as {id?:string;error?:{message?:string}}; if(!response.ok||!sent.id)throw new Error(sent.error?.message||"O Gmail recusou o envio.");
   const sentAt=new Date(); await db.update(emailMessages).set({status:"SENT",providerMessageId:sent.id,sentAt}).where(eq(emailMessages.id,message.id));
   await db.insert(activityLogs).values({ownerId:owner,companyId:company.id,type:"EMAIL_SENT",description:`E-mail em lote enviado para ${recipient}`,createdAt:sentAt});
   results.push({companyId:company.id,company:company.name,recipient,status:"SENT"});
  }catch(error){const reason=error instanceof Error?error.message:"Falha desconhecida";await db.update(emailMessages).set({status:"FAILED",errorMessage:reason}).where(eq(emailMessages.id,message.id));results.push({companyId:company.id,company:company.name,recipient,status:"FAILED",error:reason});}
 }
 return NextResponse.json({total:results.length,sent:results.filter(r=>r.status==="SENT").length,failed:results.filter(r=>r.status==="FAILED").length,skipped:results.filter(r=>r.status==="SKIPPED").length,results});
}
