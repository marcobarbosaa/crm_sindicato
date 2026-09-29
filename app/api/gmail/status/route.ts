import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, emailAccounts } from "@/db/schema";
import { gmailConfigured } from "@/lib/gmail";

const GMAIL_SEND_SCOPE="https://www.googleapis.com/auth/gmail.send";
const ownerId = () => "local-preview-user";
export async function GET() {
  const owner=ownerId(); const db=getDb(); const [account]=await db.select({id:emailAccounts.id,email:emailAccounts.email,provider:emailAccounts.provider,connectedAt:emailAccounts.connectedAt,scopes:emailAccounts.scopes}).from(emailAccounts).where(and(eq(emailAccounts.ownerId,owner),eq(emailAccounts.provider,"GMAIL"))).limit(1);
  const hasSendScope=Boolean(account?.scopes.split(/\s+/).includes(GMAIL_SEND_SCOPE));
  return NextResponse.json({ scopes:account?.scopes.split(/\s+/).filter(Boolean)||[], configured:gmailConfigured(), connected:Boolean(account)&&hasSendScope, needsReconnect:Boolean(account)&&!hasSendScope, account:account?{email:account.email,connectedAt:account.connectedAt}:null });
}
export async function DELETE() {
  const owner=ownerId(); const db=getDb(); const [removed]=await db.delete(emailAccounts).where(and(eq(emailAccounts.ownerId,owner),eq(emailAccounts.provider,"GMAIL"))).returning();
  if(removed)await db.insert(activityLogs).values({ownerId:owner,companyId:null,type:"GMAIL_DISCONNECTED",description:`Conta ${removed.email} desconectada`,createdAt:new Date()});
  return NextResponse.json({ok:true});
}
