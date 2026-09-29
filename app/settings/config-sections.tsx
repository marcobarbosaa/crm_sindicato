import { Globe, UserRound, Signature, FileText, Send, ShieldCheck, Clock, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SettingsSection, StatList, formatDate } from "./shared";
import type { ConfigProps, SettingsDestination, SettingsSummary } from "./types";

export function GeneralSettings({ config, update }: ConfigProps) {
  return <>
    <SettingsSection icon={UserRound} title="Identidade do remetente" description="Informações usadas nos envios de e-mails.">
      <div className="field"><Label htmlFor="sender-name">Nome do remetente</Label><Input id="sender-name" maxLength={100} value={config.senderName} onChange={event => update({ senderName: event.target.value })} placeholder="Seu nome ou o nome da organização" /><small>Este nome será exibido para os destinatários dos seus e-mails.</small></div>
    </SettingsSection>
    <SettingsSection icon={Globe} title="Preferências regionais" description="Defina o fuso usado no limite diário de envios.">
      <div className="field"><Label htmlFor="settings-timezone">Fuso horário</Label><select id="settings-timezone" value={config.timezone} onChange={event => update({ timezone: event.target.value as ConfigProps["config"]["timezone"] })}><option value="America/Sao_Paulo">Brasília (GMT−3)</option><option value="UTC">UTC (GMT+0)</option></select><small>A contagem diária de envios reinicia à meia-noite deste fuso. Os prazos de follow-ups continuam usando o horário de Brasília.</small></div>
      <p className="preferences-note">A interface utiliza português do Brasil.</p>
    </SettingsSection>
  </>;
}
export function EmailSettings({ config, update, navigate }: ConfigProps & { navigate: (view: SettingsDestination) => void }) {
  return <>
    <SettingsSection icon={Signature} title="Assinatura de e-mail" description="Adicionada automaticamente ao final de cada mensagem enviada.">
      <div className="preferences-signature-grid">
        <div className="field"><Label htmlFor="signature">Assinatura em texto simples</Label><Textarea id="signature" maxLength={2000} value={config.signature} onChange={event => update({ signature: event.target.value })} placeholder={"Atenciosamente,\nSeu nome\nSua organização"} /><small aria-live="polite">{config.signature.length} / 2000 caracteres</small></div>
        <div className="preferences-preview" aria-label="Prévia da assinatura"><span>PRÉVIA DO E-MAIL</span><p>Para: empresa@exemplo.com<br />Assunto: Apresentação</p><hr /><p>Olá,</p><p>Esta é uma mensagem de exemplo para mostrar como sua assinatura será exibida.</p>{config.signature ? <><hr /><p className="preferences-signature">{config.signature.trim()}</p></> : <p className="preferences-muted">Sua assinatura aparecerá aqui.</p>}</div>
      </div>
    </SettingsSection>
    <SettingsSection icon={FileText} title="Conteúdo e histórico" description="Comportamento atual das mensagens.">
      <p>Os envios utilizam texto simples e ficam registrados no histórico do CRM, incluindo tentativas com erro. A assinatura salva é incluída nos envios individuais, em lote e nas campanhas.</p>
      <Button variant="outline" onClick={() => navigate("templates")}><FileText />Gerenciar templates</Button>
    </SettingsSection>
  </>;
}
export function SendingSettings({ config, update, navigate }: ConfigProps & { navigate: (view: SettingsDestination) => void }) {
  return <>
    <SettingsSection icon={Send} title="Limite diário de envios" description="Um limite compartilhado entre envios individuais, lotes e campanhas.">
      <div className="field"><Label htmlFor="daily-limit">Máximo de e-mails por dia</Label><Input id="daily-limit" type="number" min={1} max={500} step={1} required value={config.dailySendLimit || ""} onChange={event => update({ dailySendLimit: Number(event.target.value) })} /><small>Entre 1 e 500. O Gmail também aplica seus próprios limites.</small></div>
    </SettingsSection>
    <SettingsSection icon={ShieldCheck} title="Envio em lote" description="Regras operacionais já aplicadas pelo CRM.">
      <p>O envio em lote rápido é limitado a 20 destinatários por vez e exige confirmação. Endereços inválidos são ignorados; mensagens repetidas nas últimas 24 horas são verificadas antes do envio.</p>
    </SettingsSection>
    <SettingsSection icon={Clock} title="Ritmo das campanhas" description="Cada campanha possui seu próprio tamanho de lote e intervalo.">
      <p>Configure o ritmo no módulo de envio em lote. As campanhas respeitam o limite diário definido aqui.</p>
      <Button variant="outline" onClick={() => navigate("batch")}><Send />Gerenciar envios em lote</Button>
    </SettingsSection>
  </>;
}
export function SendingUsage({ summary }: { summary: SettingsSummary }) {
  const remaining = Math.max(0, summary.dailySendLimit - summary.sentToday);
  const attempts = summary.sent + summary.failed;
  return <>
    <SettingsSection icon={BarChart3} title="Uso de envios hoje" description="Valores registrados no CRM.">
      <div className="preferences-usage"><strong>{summary.sentToday.toLocaleString("pt-BR")}</strong><span> / {summary.dailySendLimit}</span></div>
      <progress aria-label="Uso do limite diário de envios" max={summary.dailySendLimit} value={Math.min(summary.sentToday, summary.dailySendLimit)} />
      <StatList items={[["Enviados hoje", summary.sentToday], ["Limite salvo", summary.dailySendLimit], ["Restantes", remaining]]} />
      <small>Fuso: {summary.timezone === "UTC" ? "UTC" : "Brasília"} · Atualizado em {formatDate(summary.updatedAt, summary.timezone)}</small>
    </SettingsSection>
    <SettingsSection icon={FileText} title="Histórico de envios">
      <StatList items={[["Enviados", summary.sent], ["Tentativas com falha", summary.failed], ["Taxa de falhas nas tentativas", attempts ? (summary.failed / attempts * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%" : "Sem tentativas"]]} />
    </SettingsSection>
  </>;
}
