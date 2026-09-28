import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { emailCampaignRecipients, emailCampaigns } from "@/db/schema";

const ownerId=(_request:NextRequest)=>"local-preview-user";
type Action="start"|"pause"|"resume";

export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){
 const db=getDb(),owner=ownerId(request),{id:rawId}=await context.params,campaignId=Number(rawId);
 if(!Number.isInteger(campaignId))return NextResponse.json({error:"Campanha inválida."},{status:400});
 const body=await request.json().catch(()=>({})) as {action?:Action};
 const [campaign]=await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.ownerId,owner))).limit(1);
 if(!campaign)return NextResponse.json({error:"Campanha não encontrada."},{status:404});
 const now=new Date();
 if(body.action==="start"){
  if(campaign.status!=="READY")return NextResponse.json({error:"Somente campanhas preparadas podem ser iniciadas."},{status:409});
  const [updated]=await db.update(emailCampaigns).set({status:"RUNNING",nextRunAt:now,lockUntil:null,startedAt:campaign.startedAt||now,updatedAt:now}).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.ownerId,owner),eq(emailCampaigns.status,"READY"))).returning();
  return NextResponse.json(updated);
 }
 if(body.action==="pause"){
  if(campaign.status!=="RUNNING")return NextResponse.json({error:"Somente campanhas em execução podem ser pausadas."},{status:409});
  // Não libera um lock ativo: o lote que já foi adquirido pode terminar com segurança,
  // mas nenhum novo lote será iniciado enquanto a campanha estiver pausada.
  const [updated]=await db.update(emailCampaigns).set({status:"PAUSED",nextRunAt:null,updatedAt:now}).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.ownerId,owner),eq(emailCampaigns.status,"RUNNING"))).returning();
  return NextResponse.json(updated);
 }
 if(body.action==="resume"){
  if(campaign.status!=="PAUSED")return NextResponse.json({error:"Somente campanhas pausadas podem ser retomadas."},{status:409});
  const [{uncertain}]=await db.select({uncertain:sql<number>`count(*)`}).from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId,campaignId),eq(emailCampaignRecipients.status,"UNCERTAIN")));
  if(Number(uncertain||0)>0)return NextResponse.json({error:"Revise todos os envios com resultado incerto antes de retomar a campanha."},{status:409});
  const lockActive=campaign.lockUntil&&campaign.lockUntil.getTime()>now.getTime();
  const [updated]=await db.update(emailCampaigns).set({status:"RUNNING",nextRunAt:lockActive?campaign.lockUntil:now,lockUntil:lockActive?campaign.lockUntil:null,updatedAt:now}).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.ownerId,owner),eq(emailCampaigns.status,"PAUSED"))).returning();
  return NextResponse.json(updated);
 }
 return NextResponse.json({error:"Ação inválida."},{status:400});
}
