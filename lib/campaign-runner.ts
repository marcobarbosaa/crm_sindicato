import { sendingDayWindow } from "@/lib/settings";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, crmSettings, emailAccounts, emailCampaignRecipients, emailCampaigns, emailMessages, emailTemplates } from "@/db/schema";
import { loadSendAttachments } from "@/lib/attachment-service";
import { syncCampaignCounters } from "@/lib/campaign-counters";
import { decryptToken, encodeRawEmail, refreshAccessToken } from "@/lib/gmail";

const SEND_SCOPE="https://www.googleapis.com/auth/gmail.send";
const LOCK_MS=5*60_000;
const STALE_PROCESSING_MS=10*60_000;
const MAX_ATTEMPTS=3;
const personalize=(value:string,data:Record<string,string>)=>value.replace(/{{\s*(empresa|contato|segmento|cidade|estado|email_empresa)\s*}}/g,(_,key:string)=>data[key]||"");



function classifyGmailFailure(status:number,message:string){
 const normalized=message.toLowerCase();
 const retryable=status===408||status===429||status>=500||normalized.includes("rate limit")||normalized.includes("backend error")||normalized.includes("temporarily unavailable")||normalized.includes("internal error");
 return {retryable,reason:message||`Gmail retornou HTTP ${status}.`};
}

async function campaignWasPaused(campaignId:number){
 const db=getDb();
 const [campaign]=await db.select({status:emailCampaigns.status}).from(emailCampaigns).where(eq(emailCampaigns.id,campaignId)).limit(1);
 return campaign?.status==="PAUSED";
}

async function campaignWasCancelled(campaignId:number){
 const db=getDb();
 const [campaign]=await db.select({status:emailCampaigns.status}).from(emailCampaigns).where(eq(emailCampaigns.id,campaignId)).limit(1);
 return campaign?.status==="CANCELLED";
}

export async function reconcileStaleRecipients(campaignId?:number){
 const db=getDb(),cutoff=new Date(Date.now()-STALE_PROCESSING_MS);
 const stale=await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.status,"PROCESSING"),lte(emailCampaignRecipients.processingStartedAt,cutoff),campaignId?eq(emailCampaignRecipients.campaignId,campaignId):undefined)).orderBy(asc(emailCampaignRecipients.id)).limit(100);
 let recovered=0,confirmedSent=0,quarantined=0;
 for(const target of stale){
  const [message]=target.messageId?await db.select().from(emailMessages).where(eq(emailMessages.id,target.messageId)).limit(1):[];
  if(message?.status==="SENT"&&message.providerMessageId){await db.update(emailCampaignRecipients).set({status:"SENT",providerMessageId:message.providerMessageId,sentAt:message.sentAt||new Date(),processingStartedAt:null,errorMessage:null,updatedAt:new Date()}).where(eq(emailCampaignRecipients.id,target.id));confirmedSent++;continue;}
  if(message?.status==="FAILED"){await db.update(emailCampaignRecipients).set({status:"FAILED",processingStartedAt:null,errorMessage:message.errorMessage||"Falha registrada durante o envio.",updatedAt:new Date()}).where(eq(emailCampaignRecipients.id,target.id));continue;}
  if(!message){await db.update(emailCampaignRecipients).set({status:"PENDING",processingStartedAt:null,messageId:null,errorMessage:"Processamento interrompido antes da criação da mensagem; reenfileirado.",updatedAt:new Date()}).where(eq(emailCampaignRecipients.id,target.id));recovered++;continue;}
  await db.update(emailCampaignRecipients).set({status:"UNCERTAIN",processingStartedAt:null,errorMessage:"Envio interrompido após criação da mensagem; resultado no Gmail é incerto e exige revisão para evitar duplicidade.",updatedAt:new Date()}).where(eq(emailCampaignRecipients.id,target.id));quarantined++;
 }
 if(campaignId)await syncCampaignCounters(campaignId);
 return {checked:stale.length,recovered,confirmedSent,quarantined};
}

export async function claimCampaign(ownerId:string,campaignId:number){
 const db=getDb(),now=new Date(),lockUntil=new Date(now.getTime()+LOCK_MS);
 const [campaign]=await db.update(emailCampaigns).set({lockUntil,updatedAt:now}).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.ownerId,ownerId),or(eq(emailCampaigns.status,"READY"),eq(emailCampaigns.status,"RUNNING")),or(isNull(emailCampaigns.nextRunAt),lte(emailCampaigns.nextRunAt,now)),or(isNull(emailCampaigns.lockUntil),lte(emailCampaigns.lockUntil,now)))).returning();
 return campaign||null;
}

export async function getCampaignBatch(ownerId:string,campaignId:number){
 const db=getDb();const [campaign]=await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.ownerId,ownerId))).limit(1);
 if(!campaign)throw new Error("Campanha não encontrada.");if(!["READY","RUNNING"].includes(campaign.status))throw new Error("A campanha não está pronta para processamento.");
 const [settings]=await db.select().from(crmSettings).where(eq(crmSettings.ownerId,ownerId)).limit(1);const {start,next}=sendingDayWindow(settings?.timezone);
 const [{total}]=await db.select({total:sql<number>`count(*)`}).from(emailMessages).where(and(eq(emailMessages.ownerId,ownerId),eq(emailMessages.status,"SENT"),gte(emailMessages.sentAt,sql`${start.getTime()}`),lte(emailMessages.sentAt,sql`${next.getTime()-1}`)));
 const remaining=Math.max(0,(settings?.dailySendLimit||100)-Number(total||0)),take=Math.min(campaign.batchSize,remaining);
 const recipients=take>0?await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId,campaignId),eq(emailCampaignRecipients.status,"PENDING"))).orderBy(asc(emailCampaignRecipients.id)).limit(take):[];
 return {campaign,settings,remaining,recipients,nextDailyWindow:next};
}

export async function processCampaignBatch(ownerId:string,campaignId:number){
 const db=getDb();const claimed=await claimCampaign(ownerId,campaignId);if(!claimed)return {campaignId,processed:0,completed:false,paused:false,locked:true};
 try{
    await reconcileStaleRecipients(campaignId);if(await campaignWasCancelled(campaignId))return {campaignId,processed:0,completed:false,paused:false,cancelled:true,locked:false};const batch=await getCampaignBatch(ownerId,campaignId);
  if(batch.remaining<=0){
   const paused=await campaignWasPaused(campaignId);
   if(paused){await db.update(emailCampaigns).set({lockUntil:null,updatedAt:new Date()}).where(eq(emailCampaigns.id,campaignId));return {campaignId,processed:0,completed:false,paused:true,waitingDailyLimit:false,locked:false};}
   const nextRunAt=new Date(batch.nextDailyWindow.getTime()+60_000);await db.update(emailCampaigns).set({status:"RUNNING",nextRunAt,lockUntil:null,updatedAt:new Date()}).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.status,"RUNNING")));return {campaignId,processed:0,completed:false,paused:false,waitingDailyLimit:true,locked:false,nextRunAt,remainingToday:0};
  }
  if(!batch.recipients.length){const counters=await syncCampaignCounters(campaignId);if(counters.processing>0||counters.uncertain>0){await db.update(emailCampaigns).set({status:"PAUSED",lockUntil:null,nextRunAt:null,updatedAt:new Date()}).where(eq(emailCampaigns.id,campaignId));return {campaignId,processed:0,completed:false,paused:true,needsReview:true,unresolved:counters.processing+counters.uncertain,locked:false};}await db.update(emailCampaigns).set({status:"COMPLETED",pending:0,lockUntil:null,nextRunAt:null,completedAt:new Date(),updatedAt:new Date()}).where(and(eq(emailCampaigns.id,campaignId),or(eq(emailCampaigns.status,"READY"),eq(emailCampaigns.status,"RUNNING"))));return {campaignId,processed:0,completed:true,paused:false,locked:false,remainingToday:batch.remaining};}
  const [account]=await db.select().from(emailAccounts).where(and(eq(emailAccounts.ownerId,ownerId),eq(emailAccounts.provider,"GMAIL"))).limit(1);if(!account||!account.scopes.split(/\s+/).includes(SEND_SCOPE))throw new Error("Conecte o Gmail com permissão de envio antes de continuar.");
  const [template]=await db.select().from(emailTemplates).where(and(eq(emailTemplates.id,Number(batch.campaign.templateId)),eq(emailTemplates.ownerId,ownerId))).limit(1);if(!template)throw new Error("O template da campanha não está mais disponível.");
  const attachments=await loadSendAttachments(ownerId,undefined,template.id);const metadata=attachments.map(({id,name,mimeType,size})=>({id,name,mimeType,size}));const accessToken=await refreshAccessToken(await decryptToken(account.encryptedRefreshToken));let from=account.email;if(batch.settings?.senderName)from=`${batch.settings.senderName.replace(/[\r\n<>]/g," ").trim()} <${account.email}>`;
  await db.update(emailCampaigns).set({startedAt:batch.campaign.startedAt||new Date(),updatedAt:new Date()}).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.status,"RUNNING")));let sent=0,failed=0,skipped=0,retried=0;
  for(const target of batch.recipients){
    if(await campaignWasPaused(campaignId)||await campaignWasCancelled(campaignId))break;
   const data=target.personalization||{},subject=personalize(template.subject,data),messageBody=personalize(template.body,data),body=batch.settings?.signature?`${messageBody}\n\n${batch.settings.signature}`:messageBody;
   const [duplicate]=await db.select({id:emailMessages.id}).from(emailMessages).where(and(eq(emailMessages.ownerId,ownerId),eq(emailMessages.recipient,target.recipient),eq(emailMessages.subject,subject),eq(emailMessages.status,"SENT"),gte(emailMessages.createdAt,sql`${Date.now()-24*60*60_000}`))).limit(1);
   if(duplicate){await db.update(emailCampaignRecipients).set({status:"SKIPPED",processingStartedAt:null,errorMessage:"E-mail igual enviado nas últimas 24 horas.",updatedAt:new Date()}).where(eq(emailCampaignRecipients.id,target.id));skipped++;continue;}
   const now=new Date();const [claimedTarget]=await db.update(emailCampaignRecipients).set({status:"PROCESSING",attempts:target.attempts+1,processingStartedAt:now,errorMessage:null,updatedAt:now}).where(and(eq(emailCampaignRecipients.id,target.id),eq(emailCampaignRecipients.status,"PENDING"))).returning();if(!claimedTarget)continue;
   const [message]=await db.insert(emailMessages).values({ownerId,companyId:target.companyId,contactId:target.contactId,templateId:template.id,campaignId,recipient:target.recipient,subject,body,attachments:metadata,status:"QUEUED",kind:"BATCH",createdAt:now}).returning();await db.update(emailCampaignRecipients).set({messageId:message.id,updatedAt:new Date()}).where(and(eq(emailCampaignRecipients.id,target.id),eq(emailCampaignRecipients.status,"PROCESSING")));
   try{
    const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({raw:encodeRawEmail({from,to:target.recipient,subject,body,attachments})})});const result=await response.json() as {id?:string;error?:{message?:string}};
    if(!response.ok||!result.id){const failure=classifyGmailFailure(response.status,result.error?.message||"");const reason=failure.reason;if(failure.retryable&&claimedTarget.attempts<MAX_ATTEMPTS){await db.update(emailMessages).set({status:"FAILED",errorMessage:`Falha temporária: ${reason}`}).where(eq(emailMessages.id,message.id));await db.update(emailCampaignRecipients).set({status:"PENDING",processingStartedAt:null,messageId:null,errorMessage:`Tentativa ${claimedTarget.attempts}/${MAX_ATTEMPTS} falhou temporariamente: ${reason}`,updatedAt:new Date()}).where(eq(emailCampaignRecipients.id,target.id));retried++;continue;}throw new Error(reason);}
    const sentAt=new Date();await db.update(emailMessages).set({status:"SENT",providerMessageId:result.id,sentAt}).where(eq(emailMessages.id,message.id));await db.update(emailCampaignRecipients).set({status:"SENT",providerMessageId:result.id,sentAt,processingStartedAt:null,errorMessage:null,updatedAt:sentAt}).where(eq(emailCampaignRecipients.id,target.id));if(target.companyId)await db.insert(activityLogs).values({ownerId,companyId:target.companyId,type:"EMAIL_SENT",description:`E-mail da campanha #${campaignId} enviado para ${target.recipient}`,createdAt:sentAt});sent++;
   }catch(error){const reason=error instanceof Error?error.message:"Falha desconhecida";await db.update(emailMessages).set({status:"FAILED",errorMessage:reason}).where(eq(emailMessages.id,message.id));await db.update(emailCampaignRecipients).set({status:"FAILED",processingStartedAt:null,errorMessage:reason,updatedAt:new Date()}).where(eq(emailCampaignRecipients.id,target.id));failed++;}
  }
    const counters=await syncCampaignCounters(campaignId);const paused=await campaignWasPaused(campaignId),cancelled=await campaignWasCancelled(campaignId);if(cancelled)return {campaignId,processed:sent+failed+skipped+retried,sent,failed,skipped,retried,completed:false,paused:false,cancelled:true,waitingDailyLimit:false,locked:false,counters};const completed=!paused&&counters.pending===0;const now=new Date(),nextRunAt=completed||paused?null:new Date(now.getTime()+batch.campaign.intervalMinutes*60_000);
  if(paused){await db.update(emailCampaigns).set({nextRunAt:null,lockUntil:null,updatedAt:now}).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.status,"PAUSED")));}
  else{await db.update(emailCampaigns).set({status:completed?"COMPLETED":"RUNNING",nextRunAt,lockUntil:null,completedAt:completed?now:null,updatedAt:now}).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.status,"RUNNING")));}
  return {campaignId,processed:sent+failed+skipped+retried,sent,failed,skipped,retried,completed,paused,waitingDailyLimit:false,locked:false,nextRunAt,remainingToday:Math.max(0,batch.remaining-sent),counters};
 }catch(error){await syncCampaignCounters(campaignId);await db.update(emailCampaigns).set({lockUntil:null,updatedAt:new Date()}).where(eq(emailCampaigns.id,campaignId));throw error;}
}

export async function findDueCampaigns(limit=10){const db=getDb(),now=new Date();return db.select({id:emailCampaigns.id,ownerId:emailCampaigns.ownerId}).from(emailCampaigns).where(and(or(eq(emailCampaigns.status,"READY"),eq(emailCampaigns.status,"RUNNING")),or(isNull(emailCampaigns.nextRunAt),lte(emailCampaigns.nextRunAt,now)),or(isNull(emailCampaigns.lockUntil),lte(emailCampaigns.lockUntil,now)))).orderBy(asc(emailCampaigns.nextRunAt),asc(emailCampaigns.id)).limit(limit);}
