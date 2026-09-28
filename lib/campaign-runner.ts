import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, crmSettings, emailAccounts, emailCampaignRecipients, emailCampaigns, emailMessages, emailTemplates } from "@/db/schema";
import { loadSendAttachments } from "@/lib/attachment-service";
import { decryptToken, encodeRawEmail, refreshAccessToken } from "@/lib/gmail";

const SEND_SCOPE="https://www.googleapis.com/auth/gmail.send";
const LOCK_MS=5*60_000;
const personalize=(value:string,data:Record<string,string>)=>value.replace(/{{\s*(empresa|contato|segmento|cidade|estado|email_empresa)\s*}}/g,(_,key:string)=>data[key]||"");

export async function claimCampaign(ownerId:string,campaignId:number){
 const db=getDb(),now=new Date(),lockUntil=new Date(now.getTime()+LOCK_MS);
 const [campaign]=await db.update(emailCampaigns).set({lockUntil,updatedAt:now}).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.ownerId,ownerId),or(eq(emailCampaigns.status,"READY"),eq(emailCampaigns.status,"RUNNING")),or(isNull(emailCampaigns.nextRunAt),lte(emailCampaigns.nextRunAt,now)),or(isNull(emailCampaigns.lockUntil),lte(emailCampaigns.lockUntil,now)))).returning();
 return campaign||null;
}

export async function getCampaignBatch(ownerId:string,campaignId:number){
 const db=getDb();
 const [campaign]=await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.ownerId,ownerId))).limit(1);
 if(!campaign)throw new Error("Campanha não encontrada.");
 if(!["READY","RUNNING"].includes(campaign.status))throw new Error("A campanha não está pronta para processamento.");
 const [settings]=await db.select().from(crmSettings).where(eq(crmSettings.ownerId,ownerId)).limit(1);
 const startToday=new Date();startToday.setUTCHours(3,0,0,0);
 const [{total}]=await db.select({total:sql<number>`count(*)`}).from(emailMessages).where(and(eq(emailMessages.ownerId,ownerId),eq(emailMessages.status,"SENT"),gte(emailMessages.sentAt,sql`${startToday.getTime()}`)));
 const remaining=Math.max(0,(settings?.dailySendLimit||100)-Number(total||0));
 const take=Math.min(campaign.batchSize,remaining);
 const recipients=take>0?await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId,campaignId),eq(emailCampaignRecipients.status,"PENDING"))).orderBy(asc(emailCampaignRecipients.id)).limit(take):[];
 return {campaign,settings,remaining,recipients};
}

export async function processCampaignBatch(ownerId:string,campaignId:number){
 const db=getDb();const claimed=await claimCampaign(ownerId,campaignId);
 if(!claimed)return {campaignId,processed:0,completed:false,paused:false,locked:true};
 try{
  const batch=await getCampaignBatch(ownerId,campaignId);
  if(batch.remaining<=0){await db.update(emailCampaigns).set({status:"PAUSED",lockUntil:null,updatedAt:new Date()}).where(eq(emailCampaigns.id,campaignId));return {campaignId,processed:0,completed:false,paused:true,locked:false,remainingToday:0};}
  if(!batch.recipients.length){await db.update(emailCampaigns).set({status:"COMPLETED",pending:0,lockUntil:null,nextRunAt:null,completedAt:new Date(),updatedAt:new Date()}).where(eq(emailCampaigns.id,campaignId));return {campaignId,processed:0,completed:true,paused:false,locked:false,remainingToday:batch.remaining};}
  const [account]=await db.select().from(emailAccounts).where(and(eq(emailAccounts.ownerId,ownerId),eq(emailAccounts.provider,"GMAIL"))).limit(1);
  if(!account||!account.scopes.split(/\s+/).includes(SEND_SCOPE))throw new Error("Conecte o Gmail com permissão de envio antes de continuar.");
  const [template]=await db.select().from(emailTemplates).where(and(eq(emailTemplates.id,Number(batch.campaign.templateId)),eq(emailTemplates.ownerId,ownerId))).limit(1);
  if(!template)throw new Error("O template da campanha não está mais disponível.");
  const attachments=await loadSendAttachments(ownerId,undefined,template.id);const metadata=attachments.map(({id,name,mimeType,size})=>({id,name,mimeType,size}));
  const accessToken=await refreshAccessToken(await decryptToken(account.encryptedRefreshToken));let from=account.email;if(batch.settings?.senderName)from=`${batch.settings.senderName.replace(/[\r\n<>]/g," ").trim()} <${account.email}>`;
  await db.update(emailCampaigns).set({status:"RUNNING",startedAt:batch.campaign.startedAt||new Date(),updatedAt:new Date()}).where(eq(emailCampaigns.id,campaignId));
  let sent=0,failed=0,skipped=0;
  for(const target of batch.recipients){
   const data=target.personalization||{};const subject=personalize(template.subject,data),messageBody=personalize(template.body,data),body=batch.settings?.signature?`${messageBody}\n\n${batch.settings.signature}`:messageBody;
   const [duplicate]=await db.select({id:emailMessages.id}).from(emailMessages).where(and(eq(emailMessages.ownerId,ownerId),eq(emailMessages.recipient,target.recipient),eq(emailMessages.subject,subject),gte(emailMessages.createdAt,sql`${Date.now()-24*60*60_000}`))).limit(1);
   if(duplicate){await db.update(emailCampaignRecipients).set({status:"SKIPPED",errorMessage:"E-mail igual enviado nas últimas 24 horas.",updatedAt:new Date()}).where(eq(emailCampaignRecipients.id,target.id));skipped++;continue;}
   const now=new Date();const [message]=await db.insert(emailMessages).values({ownerId,companyId:target.companyId,contactId:target.contactId,templateId:template.id,campaignId,recipient:target.recipient,subject,body,attachments:metadata,status:"QUEUED",kind:"BATCH",createdAt:now}).returning();
   await db.update(emailCampaignRecipients).set({status:"PROCESSING",attempts:target.attempts+1,updatedAt:now}).where(and(eq(emailCampaignRecipients.id,target.id),eq(emailCampaignRecipients.status,"PENDING")));
   try{const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({raw:encodeRawEmail({from,to:target.recipient,subject,body,attachments})})});const result=await response.json() as {id?:string;error?:{message?:string}};if(!response.ok||!result.id)throw new Error(result.error?.message||"O Gmail recusou o envio.");const sentAt=new Date();await db.update(emailMessages).set({status:"SENT",providerMessageId:result.id,sentAt}).where(eq(emailMessages.id,message.id));await db.update(emailCampaignRecipients).set({status:"SENT",providerMessageId:result.id,sentAt,updatedAt:sentAt}).where(eq(emailCampaignRecipients.id,target.id));if(target.companyId)await db.insert(activityLogs).values({ownerId,companyId:target.companyId,type:"EMAIL_SENT",description:`E-mail da campanha #${campaignId} enviado para ${target.recipient}`,createdAt:sentAt});sent++;}catch(error){const reason=error instanceof Error?error.message:"Falha desconhecida";await db.update(emailMessages).set({status:"FAILED",errorMessage:reason}).where(eq(emailMessages.id,message.id));await db.update(emailCampaignRecipients).set({status:"FAILED",errorMessage:reason,updatedAt:new Date()}).where(eq(emailCampaignRecipients.id,target.id));failed++;}
  }
  const [{pending}]=await db.select({pending:sql<number>`count(*)`}).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId,campaignId),eq(emailCampaignRecipients.status,"PENDING")));const completed=Number(pending||0)===0;const now=new Date();const nextRunAt=completed?null:new Date(now.getTime()+batch.campaign.intervalMinutes*60_000);await db.update(emailCampaigns).set({status:completed?"COMPLETED":"RUNNING",pending:Number(pending||0),sent:batch.campaign.sent+sent,failed:batch.campaign.failed+failed,skipped:batch.campaign.skipped+skipped,nextRunAt,lockUntil:null,completedAt:completed?now:null,updatedAt:now}).where(eq(emailCampaigns.id,campaignId));
  return {campaignId,processed:batch.recipients.length,sent,failed,skipped,completed,paused:false,locked:false,nextRunAt,remainingToday:Math.max(0,batch.remaining-sent)};
 }catch(error){await db.update(emailCampaigns).set({lockUntil:null,updatedAt:new Date()}).where(eq(emailCampaigns.id,campaignId));throw error;}
}

export async function findDueCampaigns(limit=10){
 const db=getDb(),now=new Date();
 return db.select({id:emailCampaigns.id,ownerId:emailCampaigns.ownerId}).from(emailCampaigns).where(and(or(eq(emailCampaigns.status,"READY"),eq(emailCampaigns.status,"RUNNING")),or(isNull(emailCampaigns.nextRunAt),lte(emailCampaigns.nextRunAt,now)),or(isNull(emailCampaigns.lockUntil),lte(emailCampaigns.lockUntil,now)))).orderBy(asc(emailCampaigns.nextRunAt),asc(emailCampaigns.id)).limit(limit);
}
