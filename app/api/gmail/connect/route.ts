import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { oauthStates } from "@/db/schema";
import { gmailConfigured, googleClientId, googleRedirectUri } from "@/lib/gmail";

export async function GET(request:NextRequest) {
  if(!gmailConfigured())return NextResponse.redirect(new URL("/?gmail=not-configured",request.url));
  const owner="local-preview-user"; const state=crypto.randomUUID(); const now=new Date();
  await getDb().insert(oauthStates).values({state,ownerId:owner,expiresAt:new Date(now.getTime()+10*60_000),createdAt:now});
  const redirectUri = googleRedirectUri(request.url);
  const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search=new URLSearchParams({client_id:googleClientId(),redirect_uri:redirectUri,response_type:"code",scope:"openid email https://www.googleapis.com/auth/gmail.send",access_type:"offline",prompt:"consent",state}).toString();
  return NextResponse.redirect(url);
}
