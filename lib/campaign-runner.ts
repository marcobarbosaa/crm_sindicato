import { and, asc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { crmSettings, emailCampaignRecipients, emailCampaigns, emailMessages } from "@/db/schema";

export async function getCampaignBatch(ownerId:string,campaignId:number){
 const db=getDb();
 const [campaign]=await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id,campaignId),eq(emailCampaigns.ownerId,ownerId))).limit(1);
 if(!campaign)throw new Error("Campanha não encontrada.");
 if(!["READY","RUNNING"].includes(campaign.status))throw new Error("A campanha não está pronta para processamento.");
 const [settings]=await db.select().from(crmSettings).where(eq(crmSettings.ownerId,ownerId)).limit(1);
 const startToday=new Date(); startToday.setUTCHours(3,0,0,0);
 const [{total}]=await db.select({total:sql<number>`count(*)`}).from(emailMessages).where(and(eq(emailMessages.ownerId,ownerId),eq(emailMessages.status,"SENT"),gte(emailMessages.sentAt,sql`${startToday.getTime()}`)));
 const remaining=Math.max(0,(settings?.dailySendLimit||100)-Number(total||0));
 const take=Math.min(campaign.batchSize,remaining);
 const recipients=take>0?await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.campaignId,campaignId),eq(emailCampaignRecipients.status,"PENDING"))).orderBy(asc(emailCampaignRecipients.id)).limit(take):[];
 return {campaign,settings,remaining,recipients};
}
