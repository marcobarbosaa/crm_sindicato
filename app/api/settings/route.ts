import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmSettings } from "@/db/schema";

const ownerId=(request:NextRequest)=>"local-preview-user";
const defaults=(owner:string)=>({ownerId:owner,senderName:"",signature:"",dailySendLimit:100,timezone:"America/Sao_Paulo",updatedAt:new Date()});
export async function GET(request:NextRequest){const db=getDb(),owner=ownerId(request);const [settings]=await db.select().from(crmSettings).where(eq(crmSettings.ownerId,owner)).limit(1);return NextResponse.json(settings||defaults(owner));}
export async function PATCH(request:NextRequest){const db=getDb(),owner=ownerId(request),body=await request.json() as {senderName?:string;signature?:string;dailySendLimit?:number;timezone?:string};const limit=Math.max(1,Math.min(500,Number(body.dailySendLimit)||100));const values={senderName:body.senderName?.trim().slice(0,100)||"",signature:body.signature?.trim().slice(0,2000)||"",dailySendLimit:limit,timezone:body.timezone==="UTC"?"UTC":"America/Sao_Paulo",updatedAt:new Date()};await db.insert(crmSettings).values({ownerId:owner,...values}).onConflictDoUpdate({target:crmSettings.ownerId,set:values});return NextResponse.json({ownerId:owner,...values});}
