"use client";

import { useEffect, useState } from "react";
import { formatCountdown, remainingTime } from "@/lib/campaign-monitoring";

export function useCampaignClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function CampaignCountdown({ nextRunAt, status }: { nextRunAt?: string | null; status: string }) {
  const now = useCampaignClock();
  if (status !== "RUNNING") return null;
  const remaining = remainingTime(nextRunAt, now);
  return <div className="cm-countdown" aria-live="off">
    {remaining > 0 ? <><span>Será iniciado em</span><strong>{formatCountdown(remaining)}</strong></>
      : <strong className="cm-preparing">Preparando próximo lote…</strong>}
  </div>;
}
