import { useRef, useState } from "react";
import { AtSign, KeyRound, Mail, RefreshCw, Send, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSection, formatDate } from "./shared";
import type { GmailStatus } from "./types";

const scopeLabels: Record<string, string> = {
  openid: "Identificar sua conta Google",
  email: "Consultar seu endereço de e-mail",
  "https://www.googleapis.com/auth/userinfo.email": "Consultar seu endereço de e-mail",
  "https://www.googleapis.com/auth/gmail.send": "Enviar e-mails em seu nome",
};
export function GmailSettings({ gmail, onDisconnected, onSent, canLeave }: { gmail: GmailStatus; onDisconnected: () => void; onSent: () => void; canLeave: () => boolean }) {
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipient, setRecipient] = useState("");
  const operation = useRef(false);
  async function disconnect() {
    if (operation.current || !confirm("Desconectar esta conta Gmail? Os novos envios ficarão indisponíveis até reconectar.")) return;
    operation.current = true; setBusy(true);
    try {
      const response = await fetch("/api/gmail/status", { method: "DELETE" });
      if (!response.ok) throw new Error("Não foi possível desconectar o Gmail.");
      onDisconnected(); toast.success("Gmail desconectado.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao desconectar."); }
    finally { operation.current = false; setBusy(false); }
  }
  async function sendTest(event: React.FormEvent) {
    event.preventDefault();
    if (operation.current || !confirm("Enviar um e-mail de teste para " + recipient + "? Este envio usa as configurações salvas e conta no limite diário.")) return;
    operation.current = true; setSending(true);
    try {
      const response = await fetch("/api/emails", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipient, subject: "[Prospecta] Teste da integração Gmail", body: "Esta é uma mensagem de teste enviada pelo CRM Prospecta para verificar a integração com o Gmail." }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar o teste.");
      toast.success("E-mail de teste enviado."); onSent();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao enviar o teste."); }
    finally { operation.current = false; setSending(false); }
  }
  const permissions = [...new Set((gmail.scopes || []).map(scope => scopeLabels[scope] || scope))];
  return <>
    <SettingsSection icon={AtSign} title="Integração com Google" description="Conta utilizada para os envios do CRM.">
      <div className="preferences-account"><span className="preferences-icon"><Mail /></span><div><strong>{gmail.account?.email || "Nenhuma conta conectada"}</strong><span className={"preferences-badge " + (gmail.connected ? "connected" : "warning")}>{gmail.connected ? "Conectada" : gmail.needsReconnect ? "Reconexão necessária" : "Não conectada"}</span></div></div>
      {gmail.account ? <p>Conectada em {formatDate(gmail.account.connectedAt)}. A autorização será validada pelo Google ao enviar.</p> : <p>Conecte uma conta Google para enviar e-mails pelo CRM.</p>}
      {!gmail.configured && <p className="preferences-note warning">A integração Google ainda precisa ser configurada no ambiente do CRM.</p>}
      <div className="preferences-actions">
        <Button asChild disabled={!gmail.configured || busy || sending}><a href={gmail.configured && !busy && !sending ? "/api/gmail/connect" : undefined} aria-disabled={!gmail.configured || busy || sending} onClick={event => { if (!gmail.configured || busy || sending || !canLeave()) event.preventDefault(); }}><RefreshCw />{gmail.account ? "Reconectar Gmail" : "Conectar Gmail"}</a></Button>
        {gmail.account && <Button variant="outline" className="preferences-danger" disabled={busy || sending} onClick={disconnect}><Unplug />{busy ? "Desconectando…" : "Desconectar"}</Button>}
      </div>
    </SettingsSection>
    {gmail.account && <SettingsSection icon={KeyRound} title="Permissões concedidas" description="Autorizações registradas na conexão com o Google.">
      {permissions.length ? <ul className="preferences-list">{permissions.map(label => <li key={label}>{label}</li>)}</ul> : <p>Não há permissões registradas para esta conexão. Reconecte para atualizar a autorização.</p>}
    </SettingsSection>}
    {gmail.connected && <SettingsSection icon={Send} title="Enviar e-mail de teste" description="Verifique a integração usando as configurações já salvas.">
      <form onSubmit={sendTest} className="preferences-test-form"><div className="field"><Label htmlFor="test-recipient">E-mail de destino</Label><Input id="test-recipient" type="email" required value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="voce@empresa.com" /></div><Button type="submit" disabled={sending || busy || !recipient.trim()}><Send />{sending ? "Enviando…" : "Enviar teste"}</Button></form>
      <small>O teste aparece no histórico e consome um envio do limite diário.</small>
    </SettingsSection>}
  </>;
}
