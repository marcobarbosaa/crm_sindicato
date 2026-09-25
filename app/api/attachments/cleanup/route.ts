import { NextRequest, NextResponse } from "next/server";
import { cleanupAttachments } from "@/lib/attachment-service";
import { storageConfig } from "@/lib/attachment-storage";
export async function POST(request: NextRequest) {
  const secret = storageConfig("ATTACHMENTS_CLEANUP_SECRET");
  if (!secret || request.headers.get("authorization") !== "Bearer " + secret) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try { return NextResponse.json(await cleanupAttachments()); }
  catch { return NextResponse.json({ error: "Não foi possível limpar os anexos. Tente novamente." }, { status: 503 }); }
}
