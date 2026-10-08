"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Building2,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  ContactRound,
  FileUp,
  History,
  LayoutDashboard,
  Mail,
  Menu,
  MoreHorizontal,
  Plus,
  Send,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast, Toaster } from "sonner";
import { CompaniesPage } from "./companies-page";
import { CompanyDetail } from "./company-detail";
import { ImportPage } from "./import-page";
import { TemplatesPage } from "./templates-page";
import { EmailsPage } from "./emails-page";
import { BatchEmailsPage } from "./batch-emails-page";
import { SmartSendsPage } from "./smart-sends-page";
import { FollowUpsPage } from "./followups-page";
import { ContactsPage } from "./contacts-page";
import { SettingsPage } from "./settings-page";
import { parseWorkforce } from "@/lib/company-size";

type Metrics = {
  total: number;
  notContacted: number;
  contacted: number;
  replied: number;
  followUps: number;
  sentToday: number;
  sentWeek: number;
  responseRate: number;
  activities: { id: number; description: string; createdAt: string }[];
};
type View =
  | "dashboard"
  | "companies"
  | "contacts"
  | "emails"
  | "batch"
  | "smart-sends"
  | "templates"
  | "imports"
  | "followups"
  | "settings";
const nav = [
  ["dashboard", "Visão geral", LayoutDashboard],
  ["companies", "Empresas", Building2],
  ["contacts", "Contatos", ContactRound],
  ["emails", "E-mails", Mail],
  ["batch", "Envio em lote", Send],
  ["smart-sends", "Envios Inteligentes", FileUp],
  ["templates", "Templates", Sparkles],
  ["imports", "Importações", FileUp],
  ["followups", "Follow-ups", CalendarClock],
  ["settings", "Configurações", Settings],
] as const;
export function CrmApp() {
  const [templateDirty, setTemplateDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [view, setView] = useState<View>("dashboard"),
    [menuOpen, setMenuOpen] = useState(false),
    [metrics, setMetrics] = useState<Metrics | null>(null),
    [refreshKey, setRefreshKey] = useState(0),
    [loading, setLoading] = useState(true),
    [dialogOpen, setDialogOpen] = useState(false),
    [selectedCompany, setSelectedCompany] = useState<number | null>(null);
  useEffect(() => {
    const show = () =>
        toast.info(
          "Use o menu lateral para acessar empresas, contatos, envios, follow-ups e configurações.",
          { duration: 6000 },
        ),
      help = (event: Event) => {
        const target = event.target as HTMLElement;
        if (target.closest(".icon-button") || target.closest(".sidebar-help"))
          show();
      },
      keyboard = (event: Event) => {
        const key = event as KeyboardEvent;
        if (key.key === "Enter" || key.key === " ") {
          key.preventDefault();
          show();
        }
      };
    document.addEventListener("click", help);
    const card = document.querySelector(".sidebar-help");
    card?.setAttribute("role", "button");
    card?.setAttribute("tabindex", "0");
    card?.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("click", help);
      card?.removeEventListener("keydown", keyboard);
    };
  }, []);
  useEffect(() => {
    // Match the server's first render before restoring a URL-selected section.
    void Promise.resolve().then(() => {
      const query = new URLSearchParams(window.location.search);
      if (query.has("settings")) setView("settings");
      else if (query.has("gmail")) setView("emails");
    });
  }, []);
  const refreshCompanies = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);
  const closeCompany = useCallback(() => setSelectedCompany(null), []);
  useEffect(() => {
    if (view !== "dashboard") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/dashboard", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const nextMetrics = await response.json() as Metrics;
        if (!controller.signal.aborted) setMetrics(nextMetrics);
      } catch {
        if (!controller.signal.aborted) toast.error("Não foi possível carregar os dados agora.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [view, refreshKey]);
  async function removeCompany(id: number, name: string) {
    if (
      !confirm(`Excluir ${name}? O histórico relacionado também será removido.`)
    )
      return;
    const r = await fetch(`/api/companies?id=${id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Empresa excluída.");
      refreshCompanies();
    } else toast.error("Não foi possível excluir a empresa.");
  }
  function navigate(next: View) {
    if (next === view) { setMenuOpen(false); return; }
    if ((view === "settings" && settingsDirty || view === "templates" && templateDirty) &&
        !confirm("Descartar as alterações não salvas?")) return;
    const url = new URL(window.location.href);
    if (next === "settings") url.searchParams.set("settings", "general");
    else url.searchParams.delete("settings");
    window.history.pushState({ ...window.history.state, crmView: next }, "", url);
    setSettingsDirty(false);
    setView(next);
    setMenuOpen(false);
  }
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      const next = new URLSearchParams(window.location.search).has("settings") ? "settings" : event.state?.crmView || "dashboard";
      if (view === "settings" && next !== view && settingsDirty && !confirm("Descartar as alterações não salvas?")) {
        const url = new URL(window.location.href);
        url.searchParams.set("settings", "general");
        window.history.pushState({ ...window.history.state, crmView: "settings" }, "", url);
        window.dispatchEvent(new Event("popstate"));
        return;
      }
      setView(next); if (next !== "settings") setSettingsDirty(false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [view, settingsDirty]);
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Mail />
          </div>
          <div>
            <strong>Prospecta</strong>
            <span>CRM de e-mails</span>
          </div>
          <button
            className="mobile-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Fechar menu"
          >
            <X />
          </button>
        </div>
        <nav aria-label="Navegação principal">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon />
              <span>{label}</span>
              {id === "followups" && metrics?.followUps ? (
                <em>{metrics.followUps}</em>
              ) : null}
            </button>
          ))}
        </nav>
        {view !== "settings" && view !== "batch" && view !== "smart-sends" && <div className="crm-sidebar-create" hidden={view === "companies"}>
          <CompanyDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            onSaved={refreshCompanies}
          />
        </div>}
        <div className="sidebar-help">
          <CircleHelp />
          <div>
            <strong>Precisa de ajuda?</strong>
            <span>Consulte o guia do projeto</span>
          </div>
        </div>
        <div className="profile">
          <div className="avatar">MB</div>
          <div>
            <strong>Minha conta</strong>
            <span>Administrador</span>
          </div>
          <MoreHorizontal />
        </div>
      </aside>
      {menuOpen && (
        <button
          className="overlay"
          onClick={() => setMenuOpen(false)}
          aria-label="Fechar menu"
        />
      )}
      <main>
        <div className="content">
          <button
            className="menu-button crm-mobile-menu"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu />
            <span>Menu</span>
          </button>
          {view === "dashboard" ? (
            <Dashboard
              metrics={metrics}
              loading={loading}
              onAdd={() => setDialogOpen(true)}
              onCompanies={() => setView("companies")}
            />
          ) : view === "companies" ? (
            <CompaniesPage
              refreshKey={refreshKey}
              onAdd={() => setDialogOpen(true)}
              onOpen={setSelectedCompany}
              onImport={() => setView("imports")}
              onRemove={removeCompany}
            />
          ) : view === "imports" ? (
            <ImportPage onImported={refreshCompanies} />
          ) : view === "templates" ? (
            <TemplatesPage onDirtyChange={setTemplateDirty} />
          ) : view === "settings" ? (
            <SettingsPage navigate={navigate} onDirtyChange={setSettingsDirty} />
          ) : view === "emails" ? (
            <EmailsPage />
          ) : (
            <ComingSoon view={view} onCompanies={() => setView("companies")} />
          )}
        </div>
      </main>
      <CompanyDetail
        companyId={selectedCompany}
        onClose={closeCompany}
        onChanged={refreshCompanies}
      />
      <Toaster richColors position="bottom-right" />
    </div>
  );
}

function Dashboard({
  metrics,
  loading,
  onAdd,
  onCompanies,
}: {
  metrics: Metrics | null;
  loading: boolean;
  onAdd: () => void;
  onCompanies: () => void;
}) {
  const cards = [
    {
      label: "Total de empresas",
      value: metrics?.total,
      Icon: Building2,
      tone: "blue",
    },
    {
      label: "Ainda não contatadas",
      value: metrics?.notContacted,
      Icon: Users,
      tone: "slate",
    },
    {
      label: "Responderam",
      value: metrics?.replied,
      Icon: Mail,
      tone: "violet",
    },
    {
      label: "Follow-ups pendentes",
      value: metrics?.followUps,
      Icon: CalendarClock,
      tone: "amber",
    },
  ];
  return (
    <>
      <section className="page-intro">
        <div>
          <p className="eyebrow">PAINEL COMERCIAL</p>
          <h1>Bom dia, Marco</h1>
          <p>Acompanhe sua prospecção e veja o que precisa de atenção.</p>
        </div>
        <div className="intro-actions">
          <Button variant="outline" onClick={onCompanies}>
            Ver empresas
          </Button>
          <Button onClick={onAdd}>
            <Plus />
            Nova empresa
          </Button>
        </div>
      </section>
      <section className="metric-grid">
        {cards.map(({ label, value, Icon, tone }) => (
          <article className="metric-card" key={label}>
            <div className={`metric-icon ${tone}`}>
              <Icon />
            </div>
            <div>
              <span>{label}</span>
              {loading ? (
                <Skeleton className="mt-2 h-8 w-14" />
              ) : (
                <strong>{value ?? 0}</strong>
              )}
            </div>
          </article>
        ))}
      </section>
      <section className="dashboard-grid">
        <article className="panel performance">
          <div className="panel-heading">
            <div>
              <h2>Desempenho de e-mails</h2>
              <p>Resumo dos últimos 7 dias</p>
            </div>
            <Badge variant="outline">
              7 dias <ChevronDown />
            </Badge>
          </div>
          <div className="performance-row">
            <div>
              <span>Enviados hoje</span>
              <strong>{metrics?.sentToday ?? 0}</strong>
            </div>
            <div>
              <span>Enviados no período</span>
              <strong>{metrics?.sentWeek ?? 0}</strong>
            </div>
            <div>
              <span>Taxa de resposta</span>
              <strong>{metrics?.responseRate ?? 0}%</strong>
            </div>
          </div>
          <div className="quiet-chart">
            <div
              style={{ height: `${Math.max(8, metrics?.responseRate ?? 0)}%` }}
            />
            <span>
              Os indicadores aparecerão conforme os envios forem registrados.
            </span>
          </div>
        </article>
        <article className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h2>Atividade recente</h2>
              <p>Últimas ações registradas</p>
            </div>
            <Activity />
          </div>
          {loading ? (
            <div className="skeleton-stack">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          ) : metrics?.activities.length ? (
            <ul className="activity-list">
              {metrics.activities.map((a) => (
                <li key={a.id}>
                  <span />
                  <div>
                    <strong>{a.description}</strong>
                    <small>
                      {new Date(a.createdAt).toLocaleString("pt-BR")}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyActivity onAdd={onAdd} />
          )}
        </article>
      </section>
      <section className="quick-start">
        <div className="quick-icon">
          <Sparkles />
        </div>
        <div>
          <h2>Comece sua prospecção</h2>
          <p>
            Cadastre sua primeira empresa. A importação por planilha entra na
            próxima etapa.
          </p>
        </div>
        <Button onClick={onAdd}>Cadastrar empresa</Button>
      </section>
    </>
  );
}

function CompanyDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false),
    [employeeCount, setEmployeeCount] = useState("");
  const companySize = parseWorkforce(employeeCount).companySize;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const response = await fetch("/api/companies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = (await response.json()) as { error?: string };
    setSaving(false);
    if (!response.ok) {
      toast.error(body.error || "Não foi possível cadastrar.");
      return;
    }
    toast.success("Empresa cadastrada com sucesso.");
    setEmployeeCount("");
    onOpenChange(false);
    onSaved();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) setEmployeeCount("");
        onOpenChange(value);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Nova empresa
        </Button>
      </DialogTrigger>
      <DialogContent className="company-dialog">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Cadastrar empresa</DialogTitle>
            <DialogDescription>
              Cadastre os dados empresariais. O porte será calculado
              automaticamente pelo quadro de funcionários.
            </DialogDescription>
          </DialogHeader>
          <div className="form-grid">
            <Field
              id="name"
              label="Nome fantasia *"
              required
              placeholder="Ex.: Aurora Tecnologia"
            />
            <Field
              id="tradeName"
              label="Razão social"
              placeholder="Ex.: Aurora Tecnologia Ltda."
            />
            <Field
              id="cnpj"
              label="CNPJ"
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
            />
            <Field
              id="primaryEmail"
              label="E-mail"
              type="email"
              placeholder="contato@empresa.com"
            />
            <Field id="phone" label="Telefone" placeholder="(11) 3333-4444" />
            <WhatsAppStatusField
              name="phoneWhatsAppStatus"
              label="WhatsApp do telefone"
            />
            <Field id="mobile" label="Celular" placeholder="(11) 99999-9999" />
            <WhatsAppStatusField
              name="mobileWhatsAppStatus"
              label="WhatsApp do celular"
            />
            <Field
              id="address"
              label="Endereço"
              wide
              placeholder="Rua, número e complemento"
            />
            <Field
              id="region"
              label="Região"
              type="number"
              min="1"
              max="17"
              step="1"
              placeholder="1 a 17"
            />
            <Field id="city" label="Cidade" placeholder="São Paulo" />
            <Field id="state" label="Estado / UF" placeholder="SP" />
            <Field
              id="employeeCount"
              label="Quadro de funcionários"
              value={employeeCount}
              onChange={(event) => setEmployeeCount(event.target.value)}
              placeholder="Ex.: 25 ou 3 A 9 COLABORADORES"
            />
            <div className="field">
              <Label>Porte calculado</Label>
              <div className={`size-preview ${companySize ? "defined" : ""}`}>
                <strong>{companySize || "Sem porte automático"}</strong>
                <small>
                  {employeeCount && !companySize
                    ? "Esta faixa não possui classificação definida."
                    : "Calculado pelo quadro de funcionários."}
                </small>
              </div>
            </div>
            <Field id="website" label="Site" placeholder="empresa.com.br" />
            <Field
              id="segment"
              label="Segmento"
              placeholder="Ex.: Tecnologia"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Cadastrar empresa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WhatsAppStatusField({ name, label }: { name: string; label: string }) {
  return (
    <div className="field">
      <Label>{label}</Label>
      <Select name={name} defaultValue="UNKNOWN">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="UNKNOWN">Não verificado</SelectItem>
          <SelectItem value="YES">Possui WhatsApp</SelectItem>
          <SelectItem value="NO">Não possui</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
function Field({
  id,
  label,
  wide,
  ...props
}: { id: string; label: string; wide?: boolean } & React.ComponentProps<
  typeof Input
>) {
  return (
    <div className={`field ${wide ? "wide" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
    </div>
  );
}
function EmptyActivity({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-activity">
      <div>
        <History />
      </div>
      <strong>Nenhuma atividade ainda</strong>
      <span>As ações do CRM aparecerão aqui automaticamente.</span>
      <button onClick={onAdd}>Cadastrar empresa</button>
    </div>
  );
}
function ComingSoon({
  view,
  onCompanies,
}: {
  view: View;
  onCompanies: () => void;
}) {
  if (view === "batch") return <BatchEmailsPage />;
  if (view === "smart-sends") return <SmartSendsPage />;
  if (view === "followups") return <FollowUpsPage />;
  if (view === "contacts") return <ContactsPage />;

  const item = nav.find(([id]) => id === view);
  const Icon = item?.[2] || Settings;
  return (
    <section className="coming">
      <div className="coming-icon">
        <Icon />
      </div>
      <p className="eyebrow">PRÓXIMA ETAPA</p>
      <h1>{item?.[1]}</h1>
      <p>
        A estrutura deste módulo já está prevista na arquitetura. Ele será
        implementado depois que a base de empresas estiver validada.
      </p>
      <Button onClick={onCompanies}>Ir para empresas</Button>
    </section>
  );
}
