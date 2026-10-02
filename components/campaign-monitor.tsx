"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, CalendarDays, CheckCircle2, Clock3, List, Mail, MailCheck, Settings2, Pause, Play, RefreshCw, RotateCcw, Send, SkipForward, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { CampaignCountdown, useCampaignClock } from "@/components/campaign-countdown";
import type { CampaignMonitoring } from "@/lib/campaign-monitoring";
import { CampaignDelivery } from "@/components/campaign-delivery";

export type CampaignMonitorData = {
  id: number; name: string; status: string; total?: number; pending?: number; sent?: number;
  failed?: number; skipped?: number; batchSize?: number; intervalMinutes?: number;
  audienceWithoutEmail?: number; audienceInvalidEmail?: number;
  logicalBatch?: { id: string; recipientIds: number[]; startedAt: number } | null;
  processingNotice?: string | null;
  nextRunAt?: string | null; startedAt?: string | null; lockUntil?: string | null;
  createdAt?: string; completedAt?: string | null;
};
type ReviewRecipient = { id: number; recipient: string; companyName: string; attempts: number; errorMessage?: string | null; updatedAt: string };
const activeStatuses = ["READY", "RUNNING", "PAUSED"];
const labels: Record<string, string> = { DRAFT: "Rascunho", READY: "Pronta para iniciar", RUNNING: "Em andamento", PAUSED: "Pausada", COMPLETED: "Concluída", CANCELLED: "Cancelada" };
const number = (value: number) => value.toLocaleString("pt-BR");
const percent = (value: number, total: number) => (total > 0 ? value / total * 100 : 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
function date(value?: string | null, timezone?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Horário não disponível";
  return new Date(value).toLocaleString("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function CampaignHeader({ campaign, reviewRequired, timezone }: { campaign: CampaignMonitorData; reviewRequired: boolean; timezone?: string }) {
  const now = useCampaignClock();
  const end = campaign.completedAt ? Date.parse(campaign.completedAt) : now;
  const elapsed = campaign.startedAt ? Math.max(0, Math.floor((end - Date.parse(campaign.startedAt)) / 60000)) : null;
  return <header className="cm-card cm-header">
    <div className="cm-header-main">
      <span className="cm-header-icon"><Mail aria-hidden="true" /></span>
      <div className="cm-heading-line"><h1>{campaign.status === "RUNNING" ? "Campanha em execução" : reviewRequired ? "Revisão necessária" : `Campanha ${labels[campaign.status]?.toLowerCase() || campaign.status}`}</h1>
        <span role="status" className={`cm-badge ${reviewRequired ? "review" : campaign.status.toLowerCase()}`}><i />{reviewRequired ? "Revisão necessária" : labels[campaign.status] || campaign.status}</span></div>
      <p className="cm-name">{campaign.name}</p>
      <div className="cm-metadata">
        {campaign.startedAt && <span><CalendarDays />Iniciada em {date(campaign.startedAt, timezone)}</span>}
        {elapsed !== null && Number.isFinite(elapsed) && <span aria-live="off"><Clock3 />{campaign.completedAt ? "Duração" : "Tempo decorrido"}: {Math.floor(elapsed / 60) > 0 ? `${Math.floor(elapsed / 60)}h ` : ""}{elapsed % 60}min</span>}
        {!campaign.startedAt && <span>O início será registrado quando a campanha começar.</span>}
      </div>
    </div>
    <div className="cm-settings"><h2><span className="cm-icon"><Settings2 aria-hidden="true" /></span>Configurações da campanha</h2>
      <div><MailCheck /><p><strong>{campaign.batchSize ?? "—"} e-mails por lote</strong><span>Quantidade máxima por lote</span></p></div>
      <div><Clock3 /><p><strong>{campaign.intervalMinutes ?? "—"} minutos</strong><span>Intervalo entre os lotes</span></p></div>
    </div>
  </header>;
}

export function CampaignMonitor({ initialCampaign }: { initialCampaign: CampaignMonitorData }) {
  const [campaign, setCampaign] = useState(initialCampaign);
  const [monitoring, setMonitoring] = useState<CampaignMonitoring | null>(null);
  const [controlling, setControlling] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [reviewRecipients, setReviewRecipients] = useState<ReviewRecipient[]>([]);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [syncError, setSyncError] = useState(false);
  const [sampledAt, setSampledAt] = useState(() => Date.now());
  const [reviewError, setReviewError] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const inFlight = useRef(false), processingRef = useRef(false), mutation = useRef(false), revision = useRef(0);

  const loadReviewRecipients = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/email-campaigns/${initialCampaign.id}/review/recipients`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json() as { recipients: ReviewRecipient[] };
      if (!signal?.aborted) { setReviewRecipients(data.recipients); setReviewError(false); }
    } catch (error) { if ((error as Error).name !== "AbortError") setReviewError(true); }
  }, [initialCampaign.id]);

  const refreshCampaign = useCallback(async (signal?: AbortSignal) => {
    if (inFlight.current || mutation.current) return null;
    const version = revision.current;
    inFlight.current = true;
    try {
      const response = await fetch(`/api/email-campaigns/${initialCampaign.id}/monitor`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json() as { campaign: CampaignMonitorData; monitoring: CampaignMonitoring };
      if (signal?.aborted || version !== revision.current) return null;
      setCampaign(data.campaign); setMonitoring(data.monitoring); setSampledAt(Date.now()); setSyncError(false);
      if (data.campaign.status === "PAUSED") await loadReviewRecipients(signal);
      else { setReviewRecipients([]); setReviewError(false); }
      return data;
    } catch (error) {
      if ((error as Error).name !== "AbortError") setSyncError(true);
      return null;
    } finally { inFlight.current = false; }
  }, [initialCampaign.id, loadReviewRecipients]);

  // Preserve the 5-second synchronization and browser-assisted processing.
  // Countdown ticks never trigger requests. Failed/locked attempts wait for the next poll.
  useEffect(() => {
    const controller = new AbortController();
    async function poll() {
      const snapshot = await refreshCampaign(controller.signal);
      if (!snapshot || controller.signal.aborted || mutation.current || processingRef.current) return;
      const current = snapshot.campaign;
      if (current.status !== "RUNNING" || (current.nextRunAt && Date.parse(current.nextRunAt) > Date.now())
        || (current.lockUntil && Date.parse(current.lockUntil) > Date.now())) return;
      processingRef.current = true; setProcessing(true);
      try {
        const response = await fetch(`/api/email-campaigns/${current.id}/process`, { method: "POST", signal: controller.signal });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || "Não foi possível processar o lote.");
        if (!controller.signal.aborted) { setProcessError(null); await refreshCampaign(controller.signal); }
      } catch (error) {
        if ((error as Error).name !== "AbortError") setProcessError(error instanceof Error ? error.message : "Não foi possível processar o lote.");
      } finally {
        processingRef.current = false;
        setProcessing(false);
      }
    }
    const first = setTimeout(() => { void poll(); }, 0);
    const timer = activeStatuses.includes(campaign.status) ? setInterval(() => { void poll(); }, 5000) : null;
    return () => { clearTimeout(first); if (timer) clearInterval(timer); controller.abort(); };
  }, [initialCampaign.id, campaign.status, refreshCampaign]);

  async function control(action: "start" | "pause" | "resume" | "cancel") {
    if (mutation.current || processingRef.current) return;
    mutation.current = true; revision.current++; setControlling(true);
    try {
      const response = await fetch(`/api/email-campaigns/${campaign.id}/control`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
      });
      const data = await response.json() as CampaignMonitorData & { error?: string };
      if (!response.ok || !data?.id) throw new Error(data?.error || "Não foi possível alterar a campanha.");
      setCampaign(data); setProcessError(null);
      if (action !== "pause") setReviewRecipients([]);
      toast.success(action === "start" ? "Campanha iniciada." : action === "pause" ? "Campanha pausada." : action === "cancel" ? "Campanha cancelada." : "Campanha retomada.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível alterar a campanha."); }
    finally { mutation.current = false; setControlling(false); void refreshCampaign(); }
  }
  async function review(recipientId: number, action: "mark-sent" | "retry" | "mark-failed") {
    if (mutation.current) return;
    mutation.current = true; revision.current++; setReviewingId(recipientId);
    try {
      const response = await fetch(`/api/email-campaigns/${campaign.id}/review`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipientId, action }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível revisar o envio.");
      toast.success(action === "retry" ? "Reenvio autorizado." : action === "mark-sent" ? "Envio confirmado." : "Envio marcado como falha.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível revisar o envio."); }
    finally { mutation.current = false; await refreshCampaign(); await loadReviewRecipients(); setReviewingId(null); }
  }

  const total = campaign.total ?? 0, sent = campaign.sent ?? 0, failed = campaign.failed ?? 0;
  const skipped = campaign.skipped ?? 0, pending = campaign.pending ?? 0, processed = sent + failed + skipped;
  const progress = total > 0 ? Math.min(100, processed / total * 100) : 0;
  const reviewRequired = campaign.status === "PAUSED" && ((monitoring?.uncertain ?? 0) > 0 || reviewRecipients.length > 0);
  const serverBusy = (monitoring?.processing ?? 0) > 0 || !!(campaign.lockUntil && Date.parse(campaign.lockUntil) > sampledAt);
  const busy = controlling || processing || serverBusy || reviewingId !== null;
  const dailyLimited = monitoring?.remainingToday === 0;
  const nextSize = monitoring && campaign.batchSize ? Math.min(monitoring.queued, campaign.batchSize, monitoring.remainingToday) : null;
  const timezone = monitoring?.timezone;
  const running = campaign.status === "RUNNING";
  const sending = running && serverBusy;
  const cycleTitle = reviewRequired ? "Revisão necessária" : campaign.status === "PAUSED" ? "Campanha pausada"
    : campaign.status === "COMPLETED" ? "Campanha concluída" : campaign.status === "CANCELLED" ? "Campanha cancelada"
    : sending ? "Enviando lote atual…" : dailyLimited && running ? "Limite diário atingido"
    : campaign.status === "READY" ? "Campanha pronta" : campaign.logicalBatch ? "Continuação do lote atual" : "Próximo lote";
  const canResume = !reviewRequired && !!monitoring && !reviewError && !syncError;
  const startButton = campaign.status === "READY" ? <Button disabled={busy || syncError} onClick={() => control("start")}><Play />Iniciar campanha</Button> : null;
  const resumeButton = campaign.status === "PAUSED" && !reviewRequired ? <Button disabled={busy || !canResume} onClick={() => control("resume")}><RotateCcw />Retomar campanha</Button> : null;

  return <div className="campaign-monitor">
    <div className="cm-page-intro"><h2>Envio em lote</h2><p>Acompanhe o processamento da campanha e o resultado de cada envio.</p></div>
    <CampaignHeader campaign={campaign} reviewRequired={reviewRequired} timezone={timezone} />
    {!!((campaign.audienceWithoutEmail || 0) + (campaign.audienceInvalidEmail || 0)) && <p className="cm-notice">Excluídas na preparação: {campaign.audienceWithoutEmail || 0} sem e-mail · {campaign.audienceInvalidEmail || 0} com e-mail inválido conhecido.</p>}
    {campaign.processingNotice && <p className="cm-notice" role="status"><Clock3 />{campaign.processingNotice}</p>}
    {(syncError || reviewError) && <p className="cm-notice" role="status"><AlertTriangle />Não foi possível atualizar agora. Tentaremos novamente.{reviewError && " A lista de revisão não pôde ser sincronizada."}</p>}
    {processError && running && <p className="cm-notice" role="alert"><AlertTriangle />{processError} O processamento será verificado novamente.</p>}
    {reviewRequired && <section className="cm-card cm-review" aria-labelledby="cm-review-title">
      <div className="cm-section-heading"><AlertTriangle /><div><h2 id="cm-review-title">Revisão necessária</h2><p>{monitoring?.uncertain ?? reviewRecipients.length} envio(s) possuem resultado incerto. Revise antes de continuar para evitar duplicidades.</p></div></div>
      <p>Confira se a mensagem chegou ao destinatário antes de escolher uma ação.</p>
      <div className="cm-review-list">{reviewRecipients.map(item => <article key={item.id}>
        <div><strong>{item.companyName}</strong><p>{item.recipient}</p><small>{item.errorMessage || `Resultado não confirmado após ${item.attempts} tentativa(s).`}</small></div>
        <div className="cm-review-actions">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => review(item.id, "mark-sent")}>Confirmar enviado</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => review(item.id, "mark-failed")}>Marcar falha</Button>
          <Button size="sm" disabled={busy} onClick={() => review(item.id, "retry")}>Autorizar reenvio</Button>
        </div>
      </article>)}</div>
      {reviewRecipients.length === 0 && <p>Aguardando a lista de destinatários para revisão.</p>}
      {(monitoring?.uncertain ?? 0) > reviewRecipients.length && <p>Os demais itens serão exibidos conforme estas revisões forem resolvidas.</p>}
    </section>}
    <div className="cm-overview">
      <section className="cm-card cm-progress" aria-labelledby="cm-progress-title">
        <div className="cm-section-heading"><span className="cm-icon"><List aria-hidden="true" /></span><div><h2 id="cm-progress-title">Progresso geral da campanha</h2></div></div>
        <div className="cm-progress-numbers"><p><strong>{number(processed)}</strong> de {number(total)} processados</p><strong>{percent(processed, total)}%</strong></div>
        <div className="cm-progress-track" role="progressbar" aria-label="Progresso geral da campanha" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${processed} de ${total} processados`}><div style={{ width: `${progress}%` }} /></div>
        <p className="cm-progress-note">Processados = enviados + falhas + ignorados</p>
        <div className="cm-stats">
          {[{ label: "Enviados", value: sent, base: processed, note: "dos processados", tone: "sent", Icon: MailCheck },
            { label: "Pendentes", value: pending, base: total, note: "do total", tone: "pending", Icon: Clock3 },
            { label: "Ignorados", value: skipped, base: processed, note: "dos processados", tone: "skipped", Icon: SkipForward },
            { label: "Falhas", value: failed, base: processed, note: "dos processados", tone: "failed", Icon: XCircle }].map(({ label, value, base, note, tone, Icon }) =>
              <article className={`cm-stat ${tone}`} key={label}><span className="cm-stat-icon"><Icon aria-hidden="true" /></span><strong>{number(value)}</strong><span>{label}</span><small>{percent(value, base)}% {note}</small></article>)}
        </div>
      </section>
      <aside className={`cm-card cm-cycle ${reviewRequired || dailyLimited && running ? "attention" : ""}`} aria-labelledby="cm-cycle-title">
        <div className="cm-cycle-heading"><span className="cm-icon">{sending ? <RefreshCw className="spin" /> : reviewRequired ? <AlertTriangle /> : campaign.status === "COMPLETED" ? <CheckCircle2 /> : <Clock3 />}</span><h2 id="cm-cycle-title" aria-live="polite">{cycleTitle}</h2></div>
        {reviewRequired ? <p>Resolva os envios incertos no painel de revisão para liberar a continuidade.</p>
          : campaign.status === "PAUSED" ? <><p>O processamento está interrompido.{serverBusy && " Aguardando o encerramento seguro do lote atual."}</p>{resumeButton}</>
          : campaign.status === "COMPLETED" ? <><CheckCircle2 className="cm-state-icon" /><p>Todos os destinatários foram processados.</p>{campaign.completedAt && <small>Concluída em {date(campaign.completedAt, timezone)}</small>}</>
          : campaign.status === "CANCELLED" ? <><Ban className="cm-state-icon" /><p>Nenhum novo destinatário será processado.</p></>
          : sending ? <><p>O servidor está processando o lote. Os resultados serão atualizados automaticamente.</p><div className="cm-interval" aria-hidden="true"><span /></div></>
          : running && dailyLimited ? <><strong className="cm-limit">Cota de hoje utilizada</strong><p>Os envios aguardam a próxima janela diária.</p><small>{campaign.nextRunAt && monitoring && Date.parse(campaign.nextRunAt) >= Date.parse(monitoring.nextDailyWindow) ? `Retomada programada para ${date(campaign.nextRunAt, timezone)}.` : `Nova janela em ${date(monitoring?.nextDailyWindow, timezone)}. Aguardando confirmação do agendamento.`}</small></>
          : campaign.status === "READY" ? <><p>{nextSize === null ? "Sincronizando a quantidade do primeiro lote…" : dailyLimited ? "O limite diário foi atingido. Ao iniciar, a campanha aguardará a próxima janela." : `Até ${nextSize} e-mails serão processados no primeiro lote.`}</p>{startButton}</>
          : running ? <><CampaignCountdown nextRunAt={campaign.nextRunAt} status={campaign.status} continuing={!!campaign.logicalBatch} /><p>{nextSize === null ? "Sincronizando a quantidade do próximo lote…" : campaign.logicalBatch ? "Concluindo o lote atual; o intervalo começa após seu término." : `Até ${nextSize} e-mails no próximo lote`}</p><div className="cm-interval" aria-hidden="true"><span /></div><small>{campaign.nextRunAt ? `Próxima execução: ${date(campaign.nextRunAt, timezone)}` : "Aguardando confirmação do próximo horário."}</small></>
          : <p>A campanha ainda não foi preparada para envio.</p>}
        {monitoring && activeStatuses.includes(campaign.status) && <div className="cm-quota"><span>Disponível hoje · sua conta</span><strong>{number(monitoring.remainingToday)} de {number(monitoring.dailySendLimit)}</strong><small>A cota é compartilhada com outros envios.</small></div>}
      </aside>
    </div>
    <section className="cm-card cm-sequence" aria-labelledby="cm-sequence-title">
      <div className="cm-section-heading"><span className="cm-icon"><List aria-hidden="true" /></span><div><h2 id="cm-sequence-title">Ciclo de envio</h2><p>O andamento confirmado e o próximo passo da campanha.</p></div><span className="cm-subtle">Intervalo de {campaign.intervalMinutes ?? "—"} min</span></div>
      <ol className="cm-flow">
        <li><span className="cm-step-icon"><CheckCircle2 /></span><div><small>ATÉ AGORA</small><h3>{number(processed)} processados</h3><p>{number(sent)} enviados · {number(failed)} falhas · {number(skipped)} ignorados</p></div></li>
        <li className="current"><span className="cm-step-icon"><Clock3 /></span><div><small>ESTADO ATUAL</small><h3>{cycleTitle}</h3><p>{running && !dailyLimited && !sending && campaign.nextRunAt ? date(campaign.nextRunAt, timezone) : labels[campaign.status] || campaign.status}</p></div></li>
        <li><span className="cm-step-icon"><Send /></span><div><small>{activeStatuses.includes(campaign.status) ? "NA FILA" : "AO ENCERRAR"}</small><h3>{number(pending)} pendentes</h3><p>{activeStatuses.includes(campaign.status) ? "Execuções sujeitas à cota diária e ao estado da campanha." : campaign.status === "CANCELLED" ? "Os destinatários restantes não serão processados." : "Processamento encerrado."}</p></div></li>
      </ol>
      <p className="cm-footnote">O histórico individual de lotes não está disponível para esta campanha. Acompanhe abaixo os registros reais dos destinatários.</p>
    </section>
    <CampaignDelivery campaignId={campaign.id} />
    <section className="cm-card cm-activity" aria-labelledby="cm-activity-title">
      <div className="cm-section-heading"><span className="cm-icon"><Clock3 aria-hidden="true" /></span><div><h2 id="cm-activity-title">Atividade dos destinatários</h2><p>Últimas atualizações registradas · até 8 destinatários</p></div><span className="cm-subtle">Horários{timezone ? ` · ${timezone}` : ""}</span></div>
      {!monitoring ? <p className="cm-empty">Aguardando os registros da campanha…</p> : monitoring.activities.length === 0 ? <p className="cm-empty">Nenhuma atividade de destinatário registrada ainda.</p>
        : <ul>{monitoring.activities.map(item => <li key={item.id}>
          <span className={`cm-activity-icon ${item.status.toLowerCase()}`}>{item.status === "SENT" ? <CheckCircle2 /> : item.status === "FAILED" || item.status === "UNCERTAIN" ? <AlertTriangle /> : <Clock3 />}</span>
          <div><strong>{{ PENDING: "Processamento adiado", SENT: "Envio registrado", FAILED: "Falha no envio", SKIPPED: "Destinatário ignorado", PROCESSING: "Envio em processamento", UNCERTAIN: "Revisão necessária" }[item.status] || item.status} · {item.companyName}</strong><p>{item.recipient}</p>{item.errorMessage && <small>{item.errorMessage}</small>}</div>
          <time dateTime={item.updatedAt}>{date(item.updatedAt, timezone)}</time>
        </li>)}</ul>}
    </section>
    {activeStatuses.includes(campaign.status) && <footer className="cm-controls"><p><span className="cm-live-dot" />{syncError ? "Sincronização temporariamente indisponível" : "Atualização automática a cada 5 segundos"}</p><div>
      {startButton}{resumeButton}
      {running && <Button variant="outline" disabled={busy} onClick={() => control("pause")}><Pause />Pausar campanha</Button>}
      <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" disabled={busy}><Ban />Cancelar campanha</Button></AlertDialogTrigger>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Cancelar esta campanha?</AlertDialogTitle><AlertDialogDescription>Os destinatários restantes não serão processados. Os e-mails já enviados serão mantidos e esta campanha não poderá ser retomada.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Manter campanha</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => control("cancel")}>Confirmar cancelamento</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div></footer>}
  </div>;
}
