type RuntimeEnv = { GOOGLE_CLIENT_ID?:string; GOOGLE_CLIENT_SECRET?:string; TOKEN_ENCRYPTION_KEY?:string; APP_URL?:string; NEXT_PUBLIC_APP_URL?:string; SITE_URL?:string; NEXT_PUBLIC_SITE_URL?:string };
const runtime = () => process.env as RuntimeEnv;

export const appBaseUrl = (requestUrl?: string) => {
  const configured = runtime().APP_URL || runtime().NEXT_PUBLIC_APP_URL || runtime().SITE_URL || runtime().NEXT_PUBLIC_SITE_URL || "";
  if (configured) return configured.replace(/\/$/, "");
  if (requestUrl) return new URL(requestUrl).origin;
  return "http://localhost:3000";
};

export const googleRedirectUri = (requestUrl?: string) => new URL("/api/gmail/callback", appBaseUrl(requestUrl)).toString();

export const gmailConfigured = () => Boolean(runtime().GOOGLE_CLIENT_ID && runtime().GOOGLE_CLIENT_SECRET && runtime().TOKEN_ENCRYPTION_KEY);
export const googleClientId = () => runtime().GOOGLE_CLIENT_ID || "";
export const googleClientSecret = () => runtime().GOOGLE_CLIENT_SECRET || "";

export async function encryptToken(value:string) {
  const key = await encryptionKey(); const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name:"AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptToken(value:string) {
  const [ivPart,dataPart] = value.split("."); if (!ivPart || !dataPart) throw new Error("Token inválido.");
  const decrypted = await crypto.subtle.decrypt({ name:"AES-GCM", iv:fromBase64Url(ivPart) }, await encryptionKey(), fromBase64Url(dataPart));
  return new TextDecoder().decode(decrypted);
}

export async function refreshAccessToken(refreshToken:string) {
  const response = await fetch("https://oauth2.googleapis.com/token", { method:"POST", headers:{"content-type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({ client_id:googleClientId(), client_secret:googleClientSecret(), refresh_token:refreshToken, grant_type:"refresh_token" }) });
  const data = await response.json() as { access_token?:string; error_description?:string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Não foi possível renovar o acesso ao Gmail.");
  return data.access_token;
}

export function encodeRawEmail({from,to,subject,body}:{from:string;to:string;subject:string;body:string}) {
  const safeFrom=from.replace(/[\r\n]/g," ").trim(),safeTo=to.replace(/[\r\n]/g,"").trim(),safeSubject=subject.replace(/[\r\n]+/g," ").trim();
  const encodedSubject = `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(safeSubject))}?=`;
  const message = [`From: ${safeFrom}`,`To: ${safeTo}`,`Subject: ${encodedSubject}`,"MIME-Version: 1.0",'Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: base64',"",bytesToBase64(new TextEncoder().encode(body))].join("\r\n");
  return toBase64Url(new TextEncoder().encode(message));
}

function bytesToBase64(bytes:Uint8Array) { let binary=""; for (const byte of bytes) binary+=String.fromCharCode(byte); return btoa(binary); }
function toBase64Url(bytes:Uint8Array) { return bytesToBase64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); }
function fromBase64Url(value:string) { const base64=value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"="); const binary=atob(base64); return Uint8Array.from(binary,c=>c.charCodeAt(0)); }
async function encryptionKey() { const secret=runtime().TOKEN_ENCRYPTION_KEY; if(!secret)throw new Error("Chave de criptografia ausente."); const raw=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret)); return crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt","decrypt"]); }
