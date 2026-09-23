import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, companies, crmSettings, emailAccounts, emailMessages } from "@/db/schema";
import { decryptToken, encodeRawEmail, refreshAccessToken } from "@/lib/gmail";

type SendInput={companyId?:number;contactId?:number;templateId?:number;recipient?:string;subject?:string;body?:string;confirmRepeat?:boolean};
const GMAIL_SEND_SCOPE="https://www.googleapis.com/auth/gmail.send";
const ownerId=(request:NextRequest)=>"local-preview-user";

export async function GET(request:NextRequest){const db=getDb(),owner=ownerId(request);return NextResponse.json(await db.select().from(emailMessages).where(eq(emailMessages.ownerId,owner)).orderBy(desc(emailMessages.createdAt)).limit(50));}

export async function POST(request:NextRequest){
 const db=getDb(),owner=ownerId(request),input=await request.json() as SendInput; const recipient=input.recipient?.trim().toLowerCase()||"",subject=input.subject?.trim()||"";let body=input.body?.trim()||"";
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))return NextResponse.json({error:"Informe um e-mail de destinatário válido."},{status:400});
 if(!subject)return NextResponse.json({error:"Informe o assunto do e-mail."},{status:400}); if(!body)return NextResponse.json({error:"Escreva o conteúdo do e-mail."},{status:400});
 if(subject.length>200||body.length>20000)return NextResponse.json({error:"O assunto ou a mensagem ultrapassou o limite permitido."},{status:400});
 const [settings]=await db.select().from(crmSettings).where(eq(crmSettings.ownerId,owner)).limit(1);const startToday=new Date();startToday.setUTCHours(3,0,0,0);const [today]=await db.select({total:sql<number>`count(*)`}).from(emailMessages).where(and(eq(emailMessages.ownerId,owner),eq(emailMessages.status,"SENT"),gte(emailMessages.sentAt,startToday)));if(Number(today?.total||0)>=(settings?.dailySendLimit||100))return NextResponse.json({error:"Seu limite diário de envios foi atingido. Ajuste-o em Configurações ou aguarde o próximo dia."},{status:429});if(settings?.signature)body=`${body}\n\n${settings.signature}`;
 const [account]=await db.select().from(emailAccounts).where(and(eq(emailAccounts.ownerId,owner),eq(emailAccounts.provider,"GMAIL"))).limit(1); if(!account)return NextResponse.json({error:"Conecte uma conta Gmail antes de enviar."},{status:409});
 if(!account.scopes.split(/\s+/).includes(GMAIL_SEND_SCOPE))return NextResponse.json({error:"Reconecte o Gmail e autorize a permissão de envio antes de continuar."},{status:409});
 if(settings?.senderName)account.email=`${settings.senderName.replace(/[\r\n<>]/g," ").trim()} <${account.email}>`;
 if(input.companyId){const [company]=await db.select({id:companies.id}).from(companies).where(and(eq(companies.id,Number(input.companyId)),eq(companies.ownerId,owner))).limit(1);if(!company)return NextResponse.json({error:"Empresa não encontrada."},{status:404});}
 if(!input.confirmRepeat){const [recent]=await db.select({id:emailMessages.id}).from(emailMessages).where(and(eq(emailMessages.ownerId,owner),eq(emailMessages.recipient,recipient),eq(emailMessages.subject,subject),gte(emailMessages.createdAt,new Date(Date.now()-10*60_000)))).limit(1);if(recent)return NextResponse.json({error:"Um e-mail igual foi preparado recentemente. Confirme para enviar novamente.",duplicate:true},{status:409});}
 const now=new Date(); const [message]=await db.insert(emailMessages).values({ownerId:owner,companyId:input.companyId||null,contactId:input.contactId||null,templateId:input.templateId||null,recipient,subject,body,status:"QUEUED",kind:"INDIVIDUAL",createdAt:now}).returning();
 try{const accessToken=await refreshAccessToken(await decryptToken(account.encryptedRefreshToken));const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({raw:encodeRawEmail({from:account.email,to:recipient,subject,body})})});const result=await response.json() as {id?:string;error?:{message?:string}};if(!response.ok||!result.id)throw new Error(result.error?.message||"O Gmail recusou o envio.");const sentAt=new Date();await db.update(emailMessages).set({status:"SENT",providerMessageId:result.id,sentAt}).where(eq(emailMessages.id,message.id));await db.insert(activityLogs).values({ownerId:owner,companyId:input.companyId||null,type:"EMAIL_SENT",description:`E-mail enviado para ${recipient}`,createdAt:sentAt});return NextResponse.json({...message,status:"SENT",providerMessageId:result.id,sentAt});}
 catch(error){const reason=error instanceof Error?error.message:"Falha desconhecida";await db.update(emailMessages).set({status:"FAILED",errorMessage:reason}).where(eq(emailMessages.id,message.id));return NextResponse.json({error:`Não foi possível enviar: ${reason}`},{status:502});}
}
