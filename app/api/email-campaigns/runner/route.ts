import { NextRequest, NextResponse } from "next/server";
import { findDueCampaigns, processCampaignBatch } from "@/lib/campaign-runner";

function authorized(request:NextRequest){
 const secret=process.env.CAMPAIGNS_RUNNER_SECRET;
 if(!secret)return false;
 return request.headers.get("authorization")===`Bearer ${secret}`;
}

export async function POST(request:NextRequest){
 if(!authorized(request))return NextResponse.json({error:"Não autorizado."},{status:401});
 const due=await findDueCampaigns(5);
 const results=[];
 for(const campaign of due){
  try{results.push(await processCampaignBatch(campaign.ownerId,campaign.id));}
  catch(error){results.push({campaignId:campaign.id,error:error instanceof Error?error.message:"Falha desconhecida"});}
 }
 return NextResponse.json({checked:due.length,results});
}
