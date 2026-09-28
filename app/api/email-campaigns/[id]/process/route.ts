import { NextRequest, NextResponse } from "next/server";
import { getCampaignBatch } from "@/lib/campaign-runner";

const ownerId=(_request:NextRequest)=>"local-preview-user";

export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}){
 const {id}=await context.params;
 const campaignId=Number(id);
 if(!Number.isInteger(campaignId))return NextResponse.json({error:"Campanha inválida."},{status:400});
 try{
  const batch=await getCampaignBatch(ownerId(request),campaignId);
  if(batch.remaining<=0)return NextResponse.json({error:"O limite diário configurado foi atingido.",paused:true},{status:429});
  if(!batch.recipients.length)return NextResponse.json({campaignId,processed:0,completed:true});
  return NextResponse.json({campaignId,processed:0,completed:false,ready:batch.recipients.length,remainingToday:batch.remaining,message:"Pacote reservado para processamento."});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível processar a campanha."},{status:409});}
}
