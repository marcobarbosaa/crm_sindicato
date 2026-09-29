"use client";

import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Clock3, MailCheck, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CampaignMonitorData } from "@/components/campaign-monitor";

const ACTIVE_STATUSES = new Set(["READY", "RUNNING", "PAUSED"]);
const STATUS_LABELS: Record<string, string> = {
  CANCELLED: "Cancelada",
  COMPLETED: "Concluida",
  DRAFT: "Rascunho",
  PAUSED: "Pausada",
  READY: "Pronta",
  RUNNING: "Em execucao",
};

export function CampaignHistory() {
  const [campaigns, setCampaigns] = useState<CampaignMonitorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  async function loadCampaigns() {
    setLoading(true);
    try {
      const response = await fetch("/api/email-campaigns", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setCampaigns((await response.json() as CampaignMonitorData[]).slice(0, 12));
    } catch {
      toast.error("Nao foi possivel carregar o historico de campanhas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    void fetch("/api/email-campaigns", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const rows = await response.json() as CampaignMonitorData[];
        if (mounted) setCampaigns(rows.slice(0, 12));
      })
      .catch(() => { if (mounted) toast.error("Nao foi possivel carregar o historico de campanhas."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  async function cancel(campaignId: number) {
    setCancellingId(campaignId);
    try {
      const response = await fetch(`/api/email-campaigns/${campaignId}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Nao foi possivel cancelar a campanha.");
      toast.success("Campanha cancelada. Nenhum novo destinatario sera processado.");
      await loadCampaigns();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel cancelar a campanha.");
    } finally {
      setCancellingId(null);
    }
  }

  return <section className="panel campaign-history">
    <div className="panel-heading">
      <div>
        <h2>Historico de campanhas</h2>
        <p>Acompanhe envios anteriores e encerre campanhas que nao devem continuar.</p>
      </div>
      <Button variant="outline" size="icon" disabled={loading} onClick={() => void loadCampaigns()} aria-label="Atualizar historico" title="Atualizar historico">
        <RefreshCw className={loading ? "spin" : ""} />
      </Button>
    </div>
    {loading ? <div className="campaign-history-empty"><RefreshCw className="spin" /> Carregando campanhas...</div> : campaigns.length ? <div className="campaign-history-list">
      {campaigns.map((campaign) => {
        const active = ACTIVE_STATUSES.has(campaign.status);
        const createdAt = campaign.createdAt ? new Date(campaign.createdAt).toLocaleString("pt-BR") : "Data indisponivel";
        return <article key={campaign.id}>
          <div className="campaign-history-main">
            <div><strong>{campaign.name}</strong><small>Criada em {createdAt}</small></div>
            <span className={`campaign-status ${campaign.status.toLowerCase()}`}>{STATUS_LABELS[campaign.status] || campaign.status}</span>
          </div>
          <div className="campaign-history-stats">
            <span><MailCheck />{campaign.sent || 0} enviados</span>
            <span><Clock3 />{campaign.pending || 0} pendentes</span>
            <span><Users />{campaign.skipped || 0} ignorados</span>
            <span><Ban />{campaign.failed || 0} falhas</span>
          </div>
          {active ? <Button variant="destructive" size="sm" disabled={cancellingId === campaign.id} onClick={() => void cancel(campaign.id)}><Ban />{cancellingId === campaign.id ? "Cancelando..." : "Cancelar"}</Button> : <CheckCircle2 className="campaign-history-finished" />}
        </article>;
      })}
    </div> : <div className="campaign-history-empty">Nenhuma campanha foi criada ainda.</div>}
  </section>;
}
