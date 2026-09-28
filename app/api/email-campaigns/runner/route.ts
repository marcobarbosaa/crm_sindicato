import { NextRequest, NextResponse } from "next/server";
import { findDueCampaigns, processCampaignBatch } from "@/lib/campaign-runner";

const MAX_CAMPAIGNS_PER_RUN = 5;

function authorized(request: NextRequest) {
  const secret = process.env.CAMPAIGNS_RUNNER_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const startedAt = new Date();
  const due = await findDueCampaigns(MAX_CAMPAIGNS_PER_RUN);
  const settled = await Promise.allSettled(
    due.map((campaign) => processCampaignBatch(campaign.ownerId, campaign.id)),
  );

  const results = settled.map((result, index) => {
    const campaignId = due[index].id;
    if (result.status === "fulfilled") return result.value;
    return {
      campaignId,
      error: result.reason instanceof Error ? result.reason.message : "Falha desconhecida",
    };
  });

  const failed = results.filter((result) => "error" in result).length;
  const locked = results.filter((result) => "locked" in result && result.locked).length;

  return NextResponse.json({
    checked: due.length,
    succeeded: results.length - failed,
    failed,
    locked,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    results,
  });
}
