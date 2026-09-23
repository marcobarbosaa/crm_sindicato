import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, emailAccounts, oauthStates } from "@/db/schema";
import { encryptToken, googleClientId, googleClientSecret } from "@/lib/gmail";

const GMAIL_SEND_SCOPE="https://www.googleapis.com/auth/gmail.send";

export async function GET(request:NextRequest) {
  const url=new URL(request.url); const state=url.searchParams.get("state"); const code=url.searchParams.get("code"); const db=getDb();
  if(!state||!code)return NextResponse.redirect(new URL("/?gmail=cancelled",url.origin));
  const [saved]=await db.select().from(oauthStates).where(and(eq(oauthStates.state,state),gt(oauthStates.expiresAt,new Date()))).limit(1);
  if(!saved)return NextResponse.redirect(new URL("/?gmail=invalid-state",url.origin));
  await db.delete(oauthStates).where(eq(oauthStates.state,state));
  try {
    const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:googleClientId(),client_secret:googleClientSecret(),redirect_uri:`${url.origin}/api/gmail/callback`,grant_type:"authorization_code"})});
    const token=await tokenResponse.json() as {access_token?:string;refresh_token?:string;scope?:string;error_description?:string}; if(!tokenResponse.ok||!token.access_token)throw new Error(token.error_description||"Falha ao autorizar o Gmail.");
    const tokenInfoResponse=await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token.access_token)}`);
    const tokenInfo=await tokenInfoResponse.json() as {scope?:string};
    const grantedScopes=token.scope||tokenInfo.scope||"";
    if(!new Set(grantedScopes.split(/\s+/).filter(Boolean)).has(GMAIL_SEND_SCOPE))return NextResponse.redirect(new URL("/?gmail=missing-scope",url.origin));
    const userResponse=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{authorization:`Bearer ${token.access_token}`}}); const user=await userResponse.json() as {email?:string}; if(!userResponse.ok||!user.email)throw new Error("Não foi possível identificar a conta Google.");
    const [existing]=await db.select().from(emailAccounts).where(and(eq(emailAccounts.ownerId,saved.ownerId),eq(emailAccounts.provider,"GMAIL"))).limit(1); const now=new Date();
    const encrypted=token.refresh_token?await encryptToken(token.refresh_token):existing?.encryptedRefreshToken; if(!encrypted)throw new Error("O Google não forneceu autorização permanente. Tente conectar novamente.");
    if(existing)await db.update(emailAccounts).set({email:user.email,encryptedRefreshToken:encrypted,scopes:grantedScopes,updatedAt:now}).where(eq(emailAccounts.id,existing.id));
    else await db.insert(emailAccounts).values({ownerId:saved.ownerId,provider:"GMAIL",email:user.email,encryptedRefreshToken:encrypted,scopes:grantedScopes,connectedAt:now,updatedAt:now});
    await db.insert(activityLogs).values({ownerId:saved.ownerId,companyId:null,type:"GMAIL_CONNECTED",description:`Conta ${user.email} conectada`,createdAt:now});
    return NextResponse.redirect(new URL("/?gmail=connected",url.origin));
  } catch { return NextResponse.redirect(new URL("/?gmail=error",url.origin)); }
}
