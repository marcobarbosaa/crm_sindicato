import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, contacts } from "@/db/schema";

export async function GET(request:NextRequest){
 const db=getDb(),owner="local-preview-user",search=request.nextUrl.searchParams.get("search")?.trim()||"";
 const base=and(eq(companies.ownerId,owner),search?or(like(contacts.name,`%${search}%`),like(contacts.email,`%${search}%`),like(companies.name,`%${search}%`),like(contacts.role,`%${search}%`)):undefined);
 const rows=await db.select({id:contacts.id,companyId:contacts.companyId,companyName:companies.name,name:contacts.name,email:contacts.email,phone:contacts.phone,role:contacts.role,isPrimary:contacts.isPrimary,createdAt:contacts.createdAt}).from(contacts).innerJoin(companies,eq(companies.id,contacts.companyId)).where(base).orderBy(asc(companies.name),desc(contacts.isPrimary),asc(contacts.name));
 return NextResponse.json(rows);
}
