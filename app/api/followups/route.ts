import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, companies, followUps } from "@/db/schema";

const ownerId=(request:NextRequest)=>"local-preview-user";
const parseDueAt=(value?:string)=>new Date(value&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)?`${value}:00-03:00`:value||"");

async function syncCompany(companyId:number,owner:string){
 const db=getDb(); const [next]=await db.select({dueAt:followUps.dueAt}).from(followUps).where(and(eq(followUps.ownerId,owner),eq(followUps.companyId,companyId),eq(followUps.status,"PENDING"))).orderBy(asc(followUps.dueAt)).limit(1);
 await db.update(companies).set({nextFollowUpAt:next?.dueAt||null,updatedAt:new Date()}).where(and(eq(companies.id,companyId),eq(companies.ownerId,owner)));
}

export async function GET(request:NextRequest){
 const db=getDb(),owner=ownerId(request);
 const rows=await db.select({id:followUps.id,companyId:followUps.companyId,companyName:companies.name,dueAt:followUps.dueAt,status:followUps.status,note:followUps.note,createdAt:followUps.createdAt}).from(followUps).innerJoin(companies,and(eq(companies.id,followUps.companyId),eq(companies.ownerId,owner))).where(eq(followUps.ownerId,owner)).orderBy(asc(followUps.dueAt));
 return NextResponse.json(rows);
}

export async function POST(request:NextRequest){
 const db=getDb(),owner=ownerId(request),input=await request.json() as {companyId?:number;dueAt?:string;note?:string}; const companyId=Number(input.companyId),dueAt=parseDueAt(input.dueAt);
 if(!Number.isInteger(companyId)||Number.isNaN(dueAt.getTime()))return NextResponse.json({error:"Informe a empresa e uma data válida."},{status:400});
 const [company]=await db.select({id:companies.id,name:companies.name}).from(companies).where(and(eq(companies.id,companyId),eq(companies.ownerId,owner))).limit(1); if(!company)return NextResponse.json({error:"Empresa não encontrada."},{status:404});
 const now=new Date(); const [created]=await db.insert(followUps).values({ownerId:owner,companyId,dueAt,status:"PENDING",note:input.note?.trim()||null,createdAt:now}).returning();
 await db.update(companies).set({status:"FOLLOW_UP",nextFollowUpAt:dueAt,updatedAt:now}).where(eq(companies.id,companyId));
 await db.insert(activityLogs).values({ownerId:owner,companyId,type:"FOLLOW_UP_CREATED",description:`Follow-up agendado para ${dueAt.toLocaleDateString("pt-BR")}`,createdAt:now});
 return NextResponse.json(created,{status:201});
}

export async function PATCH(request:NextRequest){
 const db=getDb(),owner=ownerId(request),input=await request.json() as {id?:number;status?:string}; const id=Number(input.id);
 const [item]=await db.select().from(followUps).where(and(eq(followUps.id,id),eq(followUps.ownerId,owner))).limit(1); if(!item)return NextResponse.json({error:"Follow-up não encontrado."},{status:404});
 const status=input.status==="PENDING"?"PENDING":"COMPLETED"; await db.update(followUps).set({status}).where(eq(followUps.id,id)); await syncCompany(item.companyId,owner);
 await db.insert(activityLogs).values({ownerId:owner,companyId:item.companyId,type:status==="COMPLETED"?"FOLLOW_UP_COMPLETED":"FOLLOW_UP_REOPENED",description:status==="COMPLETED"?"Follow-up concluído":"Follow-up reaberto",createdAt:new Date()});
 return NextResponse.json({ok:true});
}

export async function DELETE(request:NextRequest){
 const db=getDb(),owner=ownerId(request),id=Number(new URL(request.url).searchParams.get("id")); const [item]=await db.select().from(followUps).where(and(eq(followUps.id,id),eq(followUps.ownerId,owner))).limit(1); if(!item)return NextResponse.json({error:"Follow-up não encontrado."},{status:404});
 await db.delete(followUps).where(and(eq(followUps.id,id),eq(followUps.ownerId,owner),ne(followUps.status,"LOCKED"))); await syncCompany(item.companyId,owner); return NextResponse.json({ok:true});
}
