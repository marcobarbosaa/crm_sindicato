import { NextRequest, NextResponse } from "next/server";
import { processCampaignBatch } from "@/lib/campaign-runner";

const ownerId=()=>"local-preview-user";

export async function POST(...[, context]: [NextRequest, {params:Promise<{id:string}>}]){
 const {id}=await context.params;
 const campaignId=Number(id);
 if(!Number.isInteger(campaignId))return NextResponse.json({error:"Campanha inválida."},{status:400});
 try{
  const result=await processCampaignBatch(ownerId(),campaignId);
  return NextResponse.json(result);
 }catch{
  console.error({event:"campaign.request",campaignId,category:"INFRASTRUCTURE_FAILURE"});
  return NextResponse.json({error:"Não foi possível processar a campanha agora. Tente novamente."},{status:500});
 }
}
