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
 }catch(error){
  console.error(`[campaign ${campaignId}] falha ao processar lote`,error);
  return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível processar a campanha."},{status:500});
 }
}
