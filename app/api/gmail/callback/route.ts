import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, emailAccounts, oauthStates } from "@/db/schema";
import { GMAIL_READ_SCOPE, GmailOAuthError, encryptNewRefreshToken, googleClientId, googleClientSecret, googleRedirectUri } from "@/lib/gmail";

const GMAIL_SEND_SCOPE="https://www.googleapis.com/auth/gmail.send";

export async function GET(request:NextRequest) {
  const url=new URL(request.url); const state=url.searchParams.get("state"); const code=url.searchParams.get("code"); const db=getDb();
  if(!state||!code)return NextResponse.redirect(new URL("/?gmail=cancelled",url.origin));
  const [saved]=await db.delete(oauthStates).where(and(eq(oauthStates.state,state),gt(oauthStates.expiresAt,sql`${Date.now()}`))).returning();
  if(!saved)return NextResponse.redirect(new URL("/?gmail=invalid-state",url.origin));
  try {
    const redirectUri = googleRedirectUri(request.url);
    const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",redirect:"manual",signal:AbortSignal.timeout(30_000),headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:googleClientId(),client_secret:googleClientSecret(),redirect_uri:redirectUri,grant_type:"authorization_code"})});
    if(tokenResponse.status>=300&&tokenResponse.status<400)throw new GmailOAuthError(tokenResponse.status,"redirect_not_allowed");
    const token=await tokenResponse.json() as {access_token?:string;refresh_token?:string;scope?:string;error?:unknown}; if(!tokenResponse.ok||!token.access_token)throw new GmailOAuthError(tokenResponse.status,token.error);
    const tokenInfoResponse=await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token.access_token)}`,{redirect:"manual",signal:AbortSignal.timeout(30_000)});
    const tokenInfo=await tokenInfoResponse.json() as {scope?:string};
    if(!tokenInfoResponse.ok)throw new Error("Token verification failed");
    const grantedScopes=token.scope||tokenInfo.scope||"";
    if(![GMAIL_SEND_SCOPE,GMAIL_READ_SCOPE].every(scope=>new Set(grantedScopes.split(/\s+/).filter(Boolean)).has(scope)))return NextResponse.redirect(new URL("/?gmail=missing-scope",url.origin));
    const userResponse=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{redirect:"manual",signal:AbortSignal.timeout(30_000),headers:{authorization:`Bearer ${token.access_token}`}}); const user=await userResponse.json() as {email?:string}; if(!userResponse.ok||!user.email)throw new Error("Não foi possível identificar a conta Google.");
    const [existing]=await db.select().from(emailAccounts).where(and(eq(emailAccounts.ownerId,saved.ownerId),eq(emailAccounts.provider,"GMAIL"))).limit(1); const now=new Date();
    let encrypted:string;
    try { encrypted=await encryptNewRefreshToken(token.refresh_token); }
    catch(error) {
      if(existing&&error instanceof GmailOAuthError&&error.requiresReconnect)await db.update(emailAccounts).set({needsReconnect:true}).where(and(eq(emailAccounts.id,existing.id),eq(emailAccounts.encryptedRefreshToken,existing.encryptedRefreshToken)));
      throw error;
    }
    if(existing)await db.update(emailAccounts).set({email:user.email,encryptedRefreshToken:encrypted,scopes:grantedScopes,needsReconnect:false,updatedAt:now}).where(eq(emailAccounts.id,existing.id));
    else await db.insert(emailAccounts).values({ownerId:saved.ownerId,provider:"GMAIL",email:user.email,encryptedRefreshToken:encrypted,scopes:grantedScopes,needsReconnect:false,connectedAt:now,updatedAt:now});
    await db.insert(activityLogs).values({ownerId:saved.ownerId,companyId:null,type:"GMAIL_CONNECTED",description:`Conta ${user.email} conectada`,createdAt:now});
    console.info(JSON.stringify({event:"gmail.oauth.callback",outcome:"succeeded",refreshTokenSource:"new"}));
    return NextResponse.redirect(new URL("/?gmail=connected",url.origin));
  } catch(error) {
    console.info(JSON.stringify({event:"gmail.oauth.callback",outcome:"failed",errorCode:error instanceof GmailOAuthError?error.code:"CALLBACK_FAILED",oauthCode:error instanceof GmailOAuthError?error.oauthCode:undefined}));
    return NextResponse.redirect(new URL("/?gmail=error",url.origin)); }
}
