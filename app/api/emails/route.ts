import { SendFailure, databaseFailure, logSend } from "@/lib/send-diagnostics";
import { sendingDayWindow } from "@/lib/settings";
import { dailyCampaignUsage } from "@/lib/campaign-quota";
import { acquireSendLease, releaseSendLease } from "@/lib/shared-send-control";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, companies, crmSettings, emailAccounts, emailMessages, emailTemplates } from "@/db/schema";
import { decryptToken, encodeRawEmail, refreshAccessToken, GmailOAuthError } from "@/lib/gmail";

import { loadSendAttachments } from "@/lib/attachment-service";
import { AttachmentError } from "@/lib/attachments";

type SendInput={companyId?:number;contactId?:number;templateId?:number;recipient?:string;subject?:string;body?:string;confirmRepeat?:boolean;attachmentIds?:string[]};
const GMAIL_SEND_SCOPE="https://www.googleapis.com/auth/gmail.send";
const ownerId=()=>"local-preview-user";

export async function GET(){
 const db=getDb(),owner=ownerId();
 const rows=await db
  .select({message:emailMessages,companyName:companies.name})
  .from(emailMessages)
  .leftJoin(companies,eq(emailMessages.companyId,companies.id))
  .where(eq(emailMessages.ownerId,owner))
  .orderBy(desc(emailMessages.createdAt))
  .limit(50);
 return NextResponse.json(rows.map(({message,companyName})=>({...message,companyName:companyName||null})));
}

export async function POST(request:NextRequest){
 let lease:Awaited<ReturnType<typeof acquireSendLease>>;
 try { lease=await acquireSendLease(ownerId()); }
 catch { return NextResponse.json({error:"Não foi possível reservar o envio. Tente novamente."},{status:503}); }
 if(!lease)return NextResponse.json({error:"Há outro envio em processamento nesta conta. Aguarde e tente novamente."},{status:409});
 try { return await sendIndividual(request,lease.expiresAt); }
 finally { await releaseSendLease(ownerId(),lease.token).catch(()=>{}); }
}
async function sendIndividual(request:NextRequest,leaseExpiresAt:Date){
 const requestId=crypto.randomUUID(); let stage="validation", messageId:number|undefined, gmailAccepted=false, gmailStarted=false;
 const enter=(next:string)=>{stage=next;logSend(requestId,stage,"started");};
 const respond=(data:unknown,init?:{status:number})=>{
   const status=init?.status||200;
   logSend(requestId,stage,status>=400?"failed":"succeeded",status>=400?new SendFailure("VALIDATION_FAILURE","REQUEST_REJECTED",status):undefined);
   return NextResponse.json(data,{status,headers:{"x-request-id":requestId}});
 };
 enter("validation");
 let db:ReturnType<typeof getDb>|undefined;
 let accountSnapshot:typeof emailAccounts.$inferSelect|undefined;
 try {
 let input:SendInput;
 try { input=await request.json(); } catch { throw new SendFailure("VALIDATION_FAILURE","INVALID_JSON",400); }
 if(!input||typeof input!=="object"||Array.isArray(input)||[input.recipient,input.subject,input.body].some(v=>v!==undefined&&typeof v!=="string"))throw new SendFailure("VALIDATION_FAILURE","INVALID_INPUT",400);
 for(const key of ["companyId","contactId","templateId"] as const){
   const value:unknown=input[key];
   if(value===undefined||value===null){input[key]=undefined;continue;}
   if((typeof value!=="number"&&!(typeof value==="string"&&/^[0-9]+$/.test(value)))||!Number.isSafeInteger(Number(value))||Number(value)<=0)throw new SendFailure("VALIDATION_FAILURE","INVALID_INPUT",400);
   input[key]=Number(value);
 }
 const owner=ownerId();db=getDb();const recipient=input.recipient?.trim().toLowerCase()||"",subject=input.subject?.trim()||"";let body=input.body?.trim()||"";
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))return respond({error:"Informe um e-mail de destinatário válido."},{status:400});
 if(!subject)return respond({error:"Informe o assunto do e-mail."},{status:400}); if(!body)return respond({error:"Escreva o conteúdo do e-mail."},{status:400});
 if(subject.length>200||body.length>20000)return respond({error:"O assunto ou a mensagem ultrapassou o limite permitido."},{status:400});
 const [settings]=await db.select().from(crmSettings).where(eq(crmSettings.ownerId,owner)).limit(1);const {start:startToday,next:nextDay}=sendingDayWindow(settings?.timezone);const [today]=await db.select({total:sql<number>`count(*)`}).from(emailMessages).where(dailyCampaignUsage(owner,startToday,nextDay));if(Number(today?.total||0)>=(settings?.dailySendLimit||100))return respond({error:"Seu limite diário de envios foi atingido. Ajuste-o em Configurações ou aguarde o próximo dia."},{status:429});if(settings?.signature)body=`${body}\n\n${settings.signature}`;
 const [account]=await db.select().from(emailAccounts).where(and(eq(emailAccounts.ownerId,owner),eq(emailAccounts.provider,"GMAIL"))).limit(1); if(!account)throw new SendFailure("OAUTH_REAUTH_REQUIRED","GMAIL_ACCOUNT_MISSING",409);
 accountSnapshot=account;
 if(!account.scopes.split(/\s+/).includes(GMAIL_SEND_SCOPE))throw new SendFailure("OAUTH_REAUTH_REQUIRED","GMAIL_SCOPE_MISSING",409);
 if(settings?.senderName)account.email=`${settings.senderName.replace(/[\r\n<>]/g," ").trim()} <${account.email}>`;
 if(input.companyId){const [company]=await db.select({id:companies.id}).from(companies).where(and(eq(companies.id,Number(input.companyId)),eq(companies.ownerId,owner))).limit(1);if(!company)return respond({error:"Empresa não encontrada."},{status:404});}
 if(!input.confirmRepeat){const [recent]=await db.select({id:emailMessages.id}).from(emailMessages).where(and(eq(emailMessages.ownerId,owner),eq(emailMessages.recipient,recipient),eq(emailMessages.subject,subject),gte(emailMessages.createdAt,sql`${Date.now()-10*60_000}`))).limit(1);if(recent)return respond({error:"Um e-mail igual foi preparado recentemente. Confirme para enviar novamente.",duplicate:true},{status:409});}
 if(input.templateId){const [template]=await db.select({id:emailTemplates.id}).from(emailTemplates).where(and(eq(emailTemplates.id,Number(input.templateId)),eq(emailTemplates.ownerId,owner))).limit(1);if(!template)return respond({error:"Template não encontrado."},{status:404});}
 enter("attachments");
 const attachments=await loadSendAttachments(owner,input.attachmentIds,input.templateId);
 logSend(requestId,stage,"succeeded");
 const attachmentMetadata=attachments.map(({id,name,mimeType,size})=>({id,name,mimeType,size}));
 enter("persist-queued");
 const now=new Date(); const [message]=await db.insert(emailMessages).values({ownerId:owner,companyId:input.companyId||null,contactId:input.contactId||null,templateId:input.templateId||null,recipient,subject,body,attachments:attachmentMetadata,status:"QUEUED",kind:"INDIVIDUAL",createdAt:now}).returning();
 messageId=message.id;
 enter("oauth-refresh");
 if(account.needsReconnect)throw new GmailOAuthError(0,"invalid_grant");
 let refreshToken:string;
 try{refreshToken=await decryptToken(account.encryptedRefreshToken);}catch{throw new SendFailure("OAUTH_CONFIGURATION","TOKEN_DECRYPTION_FAILED",502);}
 const accessToken=await refreshAccessToken(refreshToken);
 logSend(requestId,stage,"succeeded");
 enter("gmail-encode");
 const raw=encodeRawEmail({from:account.email,to:recipient,subject,body,attachments});
 enter("gmail-send");
 if(Date.now()+30_000>=leaseExpiresAt.getTime())throw new SendFailure("RUNTIME_FAILURE","SEND_LEASE_EXPIRED",503);
 let response:Response;
 gmailStarted=true;
 try{response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",redirect:"manual",signal:AbortSignal.timeout(30_000),headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({raw})});}
 catch{throw new SendFailure("GMAIL_PROVIDER_FAILURE","GMAIL_TRANSPORT_FAILURE",502);}
 if(response.status>=300&&response.status<400)throw new SendFailure("GMAIL_PROVIDER_FAILURE","GMAIL_REDIRECT_REJECTED",502,response.status);
 const result=await response.json().catch(()=>null) as {id?:unknown}|null;
 if(!response.ok)gmailStarted=false;
 if(!response.ok)throw new SendFailure("GMAIL_PROVIDER_FAILURE",response.status===429?"GMAIL_RATE_LIMIT":response.status>=500?"GMAIL_TEMPORARY_FAILURE":"GMAIL_PERMANENT_FAILURE",502,response.status);
 if(typeof result?.id!=="string"||!result.id)throw new SendFailure("GMAIL_PROVIDER_FAILURE","GMAIL_INVALID_RESPONSE",502,response.status);
 gmailAccepted=true;
 logSend(requestId,stage,"succeeded");
 enter("persist-result");
 const sentAt=new Date();
 await db.update(emailMessages).set({status:"SENT",providerMessageId:result.id,sentAt}).where(eq(emailMessages.id,message.id));
 await db.insert(activityLogs).values({ownerId:owner,companyId:input.companyId||null,type:"EMAIL_SENT",description:`E-mail enviado para ${recipient}`,createdAt:sentAt});
 return respond({...message,status:"SENT",providerMessageId:result.id,sentAt});
 } catch(error) {
 const failure=error instanceof SendFailure?error:error instanceof AttachmentError?new SendFailure("ATTACHMENT_FAILURE","ATTACHMENT_INVALID",400):error instanceof GmailOAuthError?new SendFailure(error.requiresReconnect?"OAUTH_REAUTH_REQUIRED":error.requiresUserAction?"OAUTH_CONFIGURATION":"OAUTH_TEMPORARY_FAILURE",error.code,error.requiresReconnect?409:502,error.httpStatus):stage==="gmail-encode"?new SendFailure("ATTACHMENT_FAILURE","MIME_ENCODING_FAILED",400):databaseFailure(error);
 logSend(requestId,stage,"failed",failure);
 if(db&&accountSnapshot&&error instanceof GmailOAuthError&&error.requiresReconnect){
   try{await db.update(emailAccounts).set({needsReconnect:true}).where(and(eq(emailAccounts.ownerId,ownerId()),eq(emailAccounts.provider,"GMAIL"),eq(emailAccounts.encryptedRefreshToken,accountSnapshot.encryptedRefreshToken)));}
   catch(persistError){logSend(requestId,"persist-result","failed",databaseFailure(persistError));}
 }
 // Once Gmail accepted a message, never label it FAILED or imply a retry is safe.
 if(db&&messageId&&!gmailAccepted){
   try{await db.update(emailMessages).set({status:gmailStarted?"UNCERTAIN":"FAILED",errorMessage:failure.code}).where(eq(emailMessages.id,messageId));}
   catch(persistError){logSend(requestId,"persist-result","failed",databaseFailure(persistError));}
 }
 return NextResponse.json({error:gmailAccepted?"O Gmail aceitou o envio, mas houve falha ao salvar o resultado. Não reenvie antes de conferir os enviados.":failure.category==="OAUTH_REAUTH_REQUIRED"?"Reconecte sua conta Gmail em Configurações antes de enviar novamente.":"Não foi possível concluir o envio. Consulte o código de diagnóstico.",category:failure.category,errorCode:failure.code,stage,requestId,gmailAccepted},{status:failure.status,headers:{"x-request-id":requestId}});
 }
}
