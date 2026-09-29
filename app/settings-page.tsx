"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, RefreshCw, Save, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GeneralSettings, EmailSettings, SendingSettings, SendingUsage } from "./settings/config-sections";
import { GmailSettings } from "./settings/gmail-settings";
import { DataSettings, FollowUpSettings, FollowUpSummary, SecuritySettings } from "./settings/data-sections";
import { SettingsNavigation, readSettingsTab, settingsTabs } from "./settings/navigation";
import { LoadingSettings, SettingsError } from "./settings/shared";
import { requestJson, useSettingsResource } from "./settings/use-settings-resource";
import type { CrmConfig, GmailStatus, SettingsDestination, SettingsSummary, SettingsTab } from "./settings/types";

function configOnly(value: CrmConfig): CrmConfig {
  return { senderName: value.senderName, signature: value.signature, dailySendLimit: value.dailySendLimit, timezone: value.timezone };
}
export function SettingsPage({ navigate, onDirtyChange }: { navigate: (view: SettingsDestination) => void; onDirtyChange: (dirty: boolean) => void }) {
  const settings = useSettingsResource<CrmConfig>("/api/settings");
  const gmail = useSettingsResource<GmailStatus>("/api/gmail/status");
  const summary = useSettingsResource<SettingsSummary>("/api/settings/summary");
  const [draft, setDraft] = useState<CrmConfig | null>(null);
  const [active, setActive] = useState<SettingsTab>(readSettingsTab);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const config = draft || (settings.data ? configOnly(settings.data) : null);
  const dirty = Boolean(config && settings.data && JSON.stringify(config) !== JSON.stringify(configOnly(settings.data)));
  const current = settingsTabs.find(tab => tab.id === active)!;
  const valid = !!config && Number.isInteger(config.dailySendLimit) && config.dailySendLimit >= 1 && config.dailySendLimit <= 500;

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const pop = () => setActive(readSettingsTab());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function changeTab(tab: SettingsTab) {
    if (tab === active) return;
    const url = new URL(window.location.href);
    url.searchParams.set("settings", tab);
    window.history.pushState({ ...window.history.state }, "", url);
    setActive(tab);
  }
  function update(patch: Partial<CrmConfig>) { if (config) setDraft({ ...config, ...patch }); }
  async function save() {
    if (!config || !dirty || !valid || saveLock.current) return;
    saveLock.current = true; setSaving(true);
    try {
      const saved = await requestJson<CrmConfig>("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(config) });
      settings.setData(saved); setDraft(null); toast.success("Configurações salvas."); summary.reload();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { saveLock.current = false; setSaving(false); }
  }
  const summaryContent = summary.loading ? <LoadingSettings /> : summary.error ? <SettingsError message={summary.error} retry={summary.reload} /> : summary.data ? (active === "followups" ? <FollowUpSummary summary={summary.data} /> : <SendingUsage summary={summary.data} />) : null;
  const hasAside = ["gmail", "sending", "followups"].includes(active);
  return <div className="preferences-page">
    <header className="preferences-header">
      <div><p className="eyebrow"><Settings />CONFIGURAÇÕES</p><h1>Configurações</h1><p>Gerencie sua conta, preferências e comportamento do CRM.</p></div>
      <div className="preferences-header-actions"><span className="preferences-date"><CalendarDays />{new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: config?.timezone || "America/Sao_Paulo" }).format(new Date())}</span>
        <Button onClick={save} disabled={!dirty || !valid || saving || settings.loading || !!settings.error}><Save />{saving ? "Salvando…" : "Salvar alterações"}</Button>
        <small role="status">{dirty ? "Há alterações não salvas" : "Salvamento manual"}</small>
      </div>
    </header>
    <div className={"preferences-layout" + (hasAside ? " with-context" : "")}>
      <SettingsNavigation active={active} onChange={changeTab} />
      <section className="preferences-content" aria-labelledby="settings-section-title">
        <header className="preferences-section-heading"><h2 id="settings-section-title">{current.label}</h2><p>{current.description}</p></header>
        {settings.loading ? <LoadingSettings /> : settings.error ? <SettingsError message={settings.error} retry={settings.reload} /> : config && <fieldset disabled={saving} className="preferences-fields">
          {active === "general" && <GeneralSettings config={config} update={update} />}
          {active === "emails" && <EmailSettings config={config} update={update} navigate={navigate} />}
          {active === "sending" && <SendingSettings config={config} update={update} navigate={navigate} />}
          {active === "gmail" && (gmail.loading ? <LoadingSettings /> : gmail.error ? <SettingsError message={gmail.error} retry={gmail.reload} /> : gmail.data && <GmailSettings gmail={gmail.data} onDisconnected={() => gmail.setData(value => value ? { ...value, connected: false, needsReconnect: false, account: null, scopes: [] } : value)} onSent={summary.reload} canLeave={() => !dirty || confirm("Descartar as alterações não salvas e conectar o Gmail?")} />)}
          {active === "followups" && <FollowUpSettings navigate={navigate} />}
          {active === "data" && (summary.loading ? <LoadingSettings /> : summary.error ? <SettingsError message={summary.error} retry={summary.reload} /> : summary.data && <DataSettings summary={summary.data} navigate={navigate} />)}
          {active === "security" && <SecuritySettings />}
        </fieldset>}
        {["gmail", "sending", "followups", "data"].includes(active) && <Button variant="ghost" className="preferences-refresh" disabled={summary.loading} onClick={() => { summary.reload(); if (active === "gmail") gmail.reload(); }}><RefreshCw />Atualizar dados</Button>}
      </section>
      {hasAside && <aside className="preferences-context" aria-label="Resumo da seção">{summaryContent}</aside>}
    </div>
  </div>;
}
