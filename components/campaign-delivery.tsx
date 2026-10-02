"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deliveryLabels } from "@/lib/delivery-policy";

type Report = {
  items: { id: number; companyName: string; recipient: string; deliveryStatus: string; category: string | null; smtpStatus: string | null; diagnostic: string; bouncedAt: string | null }[];
  nextCursor: number | null; summary: Record<string, number>; enabled: boolean; completedAt: string | null;
  checkedAt: string | null; needsReconnect: boolean; syncError: string | null;
};
const categories = ["ADDRESS_NOT_FOUND", "DOMAIN_NOT_FOUND", "MAILBOX_FULL", "MESSAGE_REJECTED", "SPAM_REJECTED", "POLICY_REJECTION", "TEMPORARY_SERVER_FAILURE", "UNKNOWN"];
const metrics = { sent: "Enviados pelo CRM", noKnownFailure: "Sem falha conhecida", addressNotFound: "Endereço inexistente", domainNotFound: "Domínio inexistente", mailboxFull: "Caixa cheia", blocked: "Bloqueados/recusados", temporary: "Falhas temporárias", unknown: "Falhas desconhecidas", pending: "Aguardando análise" };

export function CampaignDelivery({ campaignId }: { campaignId: number }) {
  const [report, setReport] = useState<Report | null>(null), [category, setCategory] = useState(""), [cursor, setCursor] = useState(0);
  const [error, setError] = useState(false), [refresh, setRefresh] = useState(0), [exporting, setExporting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({ after: String(cursor), ...(category ? { category } : {}) });
        const response = await fetch(`/api/email-campaigns/${campaignId}/delivery?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json() as Report;
        if (!Array.isArray(data.items)) throw new Error();
        if (!controller.signal.aborted) { setReport(data); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [campaignId, category, cursor, refresh]);
  async function exportCsv() {
    setExporting(true);
    try {
      const chunks: string[] = []; let after = "0";
      // Each request is bounded. No token or Gmail content is sent to the browser.
      do {
        const params = new URLSearchParams({ format: "csv", after, ...(category ? { category } : {}) });
        const response = await fetch(`/api/email-campaigns/${campaignId}/delivery?${params}`, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const text = await response.text();
        chunks.push(chunks.length ? text.replace(/^\uFEFF?[^\r\n]*\r?\n?/, "") : text);
        const next = response.headers.get("X-Next-Cursor") || "";
        if (next && Number(next) <= Number(after)) throw new Error();
        after = next;
      } while (after);
      const url = URL.createObjectURL(new Blob(["\uFEFF", chunks.join("\r\n")], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `campanha-${campaignId}-entrega.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast.error("Não foi possível exportar o relatório completo."); }
    finally { setExporting(false); }
  }
  return <section className="cm-card cm-delivery" aria-label="Resultado de entrega">
    <div className="cm-section-heading"><div><h2>Resultado de entrega</h2><p>A ausência de devolução não comprova a entrega ou a leitura.</p></div></div>
    {error && <p role="status">Não foi possível atualizar o relatório.</p>}
    {report?.needsReconnect && <p className="cm-notice">Reconecte o Gmail em Configurações para autorizar a análise de devoluções.</p>}
    {report && !report.enabled && <p>Esta campanha anterior à ativação do monitoramento não é analisada automaticamente.</p>}
    {report?.syncError && <p role="status">{report.syncError === "PARTIAL_ANALYSIS" ? "Análise parcial: algumas notificações não puderam ser associadas com segurança." : "A análise está temporariamente indisponível. O servidor tentará novamente enquanto a campanha estiver na janela de acompanhamento."}</p>}
    {report && <><p>{report.completedAt ? "Janela de análise encerrada." : "Devoluções podem aparecer após o envio. O acompanhamento continua por até 24 horas após a conclusão."} {report.checkedAt && `Última consulta: ${new Date(report.checkedAt).toLocaleString("pt-BR")}.`}</p>
      <div className="cm-delivery-stats">{Object.entries(metrics).map(([key, label]) => <div key={key}><strong>{report.summary[key] || 0}</strong><span>{label}</span></div>)}</div></>}
    <div className="cm-delivery-tools">
      <label>Categoria <select aria-label="Categoria de entrega" value={category} onChange={event => { setCategory(event.target.value); setCursor(0); setReport(null); }}><option value="">Todas</option>{categories.map(value => <option key={value} value={value}>{deliveryLabels[value]}</option>)}</select></label>
      <Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)}>Atualizar entrega</Button>
      <Button variant="outline" size="sm" disabled={exporting || !report} onClick={() => void exportCsv()}>{exporting ? "Exportando…" : "Exportar CSV"}</Button>
    </div>
    {report && <><div className="cm-delivery-table"><table><thead><tr>{["Empresa", "E-mail", "Situação", "Motivo", "Código SMTP", "Detectado em"].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{report.items.map(item => <tr key={item.id}><td>{item.companyName}</td><td>{item.recipient}</td><td>{deliveryLabels[item.category || item.deliveryStatus] || item.deliveryStatus}</td><td>{item.diagnostic || "—"}</td><td>{item.smtpStatus || "—"}</td><td>{item.bouncedAt ? new Date(item.bouncedAt).toLocaleString("pt-BR") : "—"}</td></tr>)}</tbody></table></div>
      {!report.items.length && <p>Nenhum envio encontrado neste filtro.</p>}
      <div className="cm-delivery-tools"><Button variant="outline" size="sm" disabled={!cursor} onClick={() => { setCursor(0); setReport(null); }}>Primeira página</Button><Button variant="outline" size="sm" disabled={!report.nextCursor} onClick={() => { setCursor(report.nextCursor || 0); setReport(null); }}>Próxima página</Button></div></>}
  </section>;
}
