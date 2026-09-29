import { AtSign, CalendarClock, Database, Mail, Send, Settings, Shield } from "lucide-react";
import type { SettingsTab } from "./types";

export const settingsTabs = [
  { id: "general", label: "Geral", subtitle: "Perfil, idioma e preferências", icon: Settings, description: "Defina suas informações e preferências básicas do sistema." },
  { id: "gmail", label: "Gmail", subtitle: "Conexão e integração Google", icon: AtSign, description: "Gerencie sua conta Google, permissões e integração de envio." },
  { id: "emails", label: "E-mails", subtitle: "Assinatura e comportamento", icon: Mail, description: "Configure a assinatura e o comportamento das suas mensagens." },
  { id: "sending", label: "Envios", subtitle: "Limites e segurança", icon: Send, description: "Defina limites e regras para o envio de e-mails." },
  { id: "followups", label: "Follow-ups", subtitle: "Preferências de acompanhamento", icon: CalendarClock, description: "Configure como os acompanhamentos serão criados e gerenciados." },
  { id: "data", label: "Dados", subtitle: "Importações e informações", icon: Database, description: "Gerencie suas importações e informações armazenadas no CRM." },
  { id: "security", label: "Segurança", subtitle: "Acesso e sessões", icon: Shield, description: "Gerencie o acesso e a proteção da sua conta." },
] as const;
export function readSettingsTab(): SettingsTab {
  if (typeof window === "undefined") return "general";
  const value = new URLSearchParams(window.location.search).get("settings");
  return settingsTabs.find(tab => tab.id === value)?.id || "general";
}
export function SettingsNavigation({ active, onChange }: { active: SettingsTab; onChange: (tab: SettingsTab) => void }) {
  return <nav className="preferences-nav" aria-label="Seções de configurações">
    <label className="preferences-mobile-nav">Seção
      <select value={active} onChange={event => onChange(event.target.value as SettingsTab)}>{settingsTabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</select>
    </label>
    <div className="preferences-nav-items">{settingsTabs.map(({ id, label, subtitle, icon: Icon }) => <button key={id} type="button" aria-current={active === id ? "page" : undefined} className={active === id ? "active" : ""} onClick={() => onChange(id)}><Icon aria-hidden="true" /><span><strong>{label}</strong><small>{subtitle}</small></span></button>)}</div>
  </nav>;
}
