"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
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
  MessageCircle,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Tags,
  Trash2,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast, Toaster } from "sonner";
import { CompanyDetail } from "./company-detail";
import { ImportPage } from "./import-page";
import { TemplatesPage } from "./templates-page";
import { EmailsPage } from "./emails-page";
import { BatchEmailsPage } from "./batch-emails-page";
import { FollowUpsPage } from "./followups-page";
import { ContactsPage } from "./contacts-page";
import { SettingsPage } from "./settings-page";
import { formatCnpj, parseWorkforce } from "@/lib/company-size";
import { formatBrazilianPhone } from "@/lib/phone";

type Company = {
  id: number;
  name: string;
  tradeName?: string;
  cnpj?: string;
  website?: string;
  primaryEmail?: string;
  segment?: string;
  region?: number | null;
  city?: string;
  state?: string;
  phone?: string;
  phoneWhatsAppStatus?: "UNKNOWN" | "YES" | "NO";
  mobile?: string;
  mobileWhatsAppStatus?: "UNKNOWN" | "YES" | "NO";
  address?: string;
  employeeCount?: number | null;
  employeeRange?: string | null;
  companySize?: string | null;
  status: string;
  createdAt: string;
};
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
  ["templates", "Templates", Sparkles],
  ["imports", "Importações", FileUp],
  ["followups", "Follow-ups", CalendarClock],
  ["settings", "Configurações", Settings],
] as const;
const statusLabel: Record<string, string> = {
  NOT_CONTACTED: "Não contatada",
  CONTACTED: "Contatada",
  WAITING_REPLY: "Aguardando resposta",
  REPLIED: "Respondeu",
  FOLLOW_UP: "Follow-up",
  INTERESTED: "Interessada",
  NOT_INTERESTED: "Não interessada",
  CLOSED: "Encerrada",
};
const statusClass: Record<string, string> = {
  NOT_CONTACTED: "neutral",
  CONTACTED: "blue",
  WAITING_REPLY: "amber",
  REPLIED: "violet",
  FOLLOW_UP: "orange",
  INTERESTED: "green",
  NOT_INTERESTED: "red",
  CLOSED: "slate",
};

const normalizeText = (value?: string | null) =>
  String(value ?? "").trim().toLowerCase();

const normalizeDigits = (value?: string | null) =>
  String(value ?? "").replace(/\D/g, "");

const isFilled = (value?: string | null) => normalizeText(value).length > 0;
const regionNumber = (value: unknown) => {
  const match = String(value ?? "").match(/\d+/);
  const region = Number(match?.[0]);
  return Number.isInteger(region) && region >= 1 && region <= 17
    ? region
    : null;
};

export function CrmApp() {
  const [view, setView] = useState<View>("dashboard"),
    [menuOpen, setMenuOpen] = useState(false),
    [metrics, setMetrics] = useState<Metrics | null>(null),
    [companies, setCompanies] = useState<Company[]>([]),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [dialogOpen, setDialogOpen] = useState(false),
    [selectedCompany, setSelectedCompany] = useState<number | null>(null);
  const loadVersion = useRef(0);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("gmail")) setView("emails");
  }, []);
  useEffect(() => {
    if (view === "companies") setSearch("");
  }, [view]);
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
  const load = useCallback(async () => {
    const version = loadVersion.current;
    setLoading(true);
    try {
      const [m, c] = await Promise.all([
        fetch("/api/dashboard"),
        fetch(`/api/companies?search=${encodeURIComponent(search)}`),
      ]);
      if (!m.ok || !c.ok) throw new Error();
      if (version !== loadVersion.current) return;
      setMetrics(await m.json());
      const companyData = await c.json();
      setCompanies(Array.isArray(companyData) ? companyData : []);
    } catch {
      toast.error("Não foi possível carregar os dados agora.");
    } finally {
      setLoading(false);
    }
  }, [search]);
  useEffect(() => {
    const version = ++loadVersion.current;
    const timer = setTimeout(async () => {
      await load();
    }, 250);
    return () => clearTimeout(timer);
  }, [load]);
  async function removeCompany(id: number, name: string) {
    if (
      !confirm(`Excluir ${name}? O histórico relacionado também será removido.`)
    )
      return;
    const r = await fetch(`/api/companies?id=${id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Empresa excluída.");
      load();
    } else toast.error("Não foi possível excluir a empresa.");
  }
  const currentLabel = nav.find(([id]) => id === view)?.[1];
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
              onClick={() => {
                setView(id);
                setMenuOpen(false);
              }}
            >
              <Icon />
              <span>{label}</span>
              {id === "followups" && metrics?.followUps ? (
                <em>{metrics.followUps}</em>
              ) : null}
            </button>
          ))}
        </nav>
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
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu />
          </button>
          <div>
            <span>Workspace</span>
            <strong>{currentLabel}</strong>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Ajuda">
              <CircleHelp />
            </button>
            <CompanyDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              onSaved={load}
            />
          </div>
        </header>
        <div className="content">
          {view === "dashboard" ? (
            <Dashboard
              metrics={metrics}
              loading={loading}
              onAdd={() => setDialogOpen(true)}
              onCompanies={() => setView("companies")}
            />
          ) : view === "companies" ? (
            <Companies
              companies={companies}
              loading={loading}
              search={search}
              setSearch={setSearch}
              onAdd={() => setDialogOpen(true)}
              onOpen={setSelectedCompany}
              onImport={() => setView("imports")}
              onRemove={removeCompany}
            />
          ) : view === "imports" ? (
            <ImportPage onImported={load} />
          ) : view === "templates" ? (
            <TemplatesPage />
          ) : view === "emails" ? (
            <EmailsPage />
          ) : (
            <ComingSoon view={view} onCompanies={() => setView("companies")} />
          )}
        </div>
      </main>
      <CompanyDetail
        companyId={selectedCompany}
        onClose={() => setSelectedCompany(null)}
        onChanged={load}
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

function Companies({
  companies,
  loading,
  search,
  setSearch,
  onAdd,
  onOpen,
  onImport,
  onRemove,
}: {
  companies: Company[];
  loading: boolean;
  search: string;
  setSearch: (s: string) => void;
  onAdd: () => void;
  onOpen: (id: number) => void;
  onImport: () => void;
  onRemove: (id: number, n: string) => void;
}) {
  const [region, setRegion] = useState("all");
  const [city, setCity] = useState("all");
  const [emailFilter, setEmailFilter] = useState<"all" | "with" | "without">(
    "all",
  );
  const [phoneFilter, setPhoneFilter] = useState<"all" | "with" | "without">(
    "all",
  );
  const [mobileFilter, setMobileFilter] = useState<"all" | "with" | "without">(
    "all",
  );
  const [companySizeFilter, setCompanySizeFilter] = useState<
    "all" | "ME" | "EPP" | "Demais"
  >("all");
  const [page, setPage] = useState(1);
  const hasActiveFilters =
    search ||
    region !== "all" ||
    city !== "all" ||
    emailFilter !== "all" ||
    phoneFilter !== "all" ||
    mobileFilter !== "all" ||
    companySizeFilter !== "all";
  const safeCompanies = Array.isArray(companies) ? companies : [];

  const regions = Array.from(
    new Set(
      safeCompanies
        .map((company) => regionNumber(company.region))
        .filter((value): value is number => value !== null),
    ),
  ).sort((a, b) => a - b);
  const cities = Array.from(
    new Set(
      safeCompanies
        .filter((company) => {
          if (region === "all") return true;
          return String(regionNumber(company.region) ?? "") === region;
        })
        .map((company) => String(company.city || "").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filteredCompanies = safeCompanies.filter((company) => {
    const matchesRegion =
      region === "all" || String(regionNumber(company.region) ?? "") === region;
    const matchesCity =
      city === "all" || String(company.city || "").trim() === city;
    const matchesEmail =
      emailFilter === "all" ||
      (emailFilter === "with"
        ? isFilled(company.primaryEmail)
        : !isFilled(company.primaryEmail));
    const matchesPhone =
      phoneFilter === "all" ||
      (phoneFilter === "with" ? isFilled(company.phone) : !isFilled(company.phone));
    const matchesMobile =
      mobileFilter === "all" ||
      (mobileFilter === "with"
        ? isFilled(company.mobile)
        : !isFilled(company.mobile));
    const matchesSize =
      companySizeFilter === "all" || company.companySize === companySizeFilter;

    return (
      matchesRegion &&
      matchesCity &&
      matchesEmail &&
      matchesPhone &&
      matchesMobile &&
      matchesSize
    );
  });
  const pageSize = 50;
  const totalPages = Math.max(
    1,
    Math.ceil(filteredCompanies.length / pageSize),
  );
  const pagedCompanies = filteredCompanies.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  const clearFilters = () => {
    setSearch("");
    setRegion("all");
    setCity("all");
    setEmailFilter("all");
    setPhoneFilter("all");
    setMobileFilter("all");
    setCompanySizeFilter("all");
  };
  useEffect(
    () => setPage(1),
    [
      region,
      city,
      search,
      emailFilter,
      phoneFilter,
      mobileFilter,
      companySizeFilter,
    ],
  );
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  return (
    <>
      <section className="page-intro compact">
        <div>
          <p className="eyebrow">BASE COMERCIAL</p>
          <h1>Empresas</h1>
          <p>Organize prospects, contatos e próximos passos.</p>
        </div>
        <Button onClick={onAdd}>
          <Plus />
          Nova empresa
        </Button>
      </section>
      <section className="panel companies-panel">
        <div className="table-tools">
          <div className="companies-toolbar-primary">
            <div className="search">
              <Search />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, CNPJ, e-mail ou segmento"
              />
            </div>
          </div>
          <div className="company-filter-row">
          <Select
            value={region}
            onValueChange={(value) => {
              setRegion(value);
              setCity("all");
            }}
          >
            <SelectTrigger className="filter-select">
              <SelectValue placeholder="Todas as regiões" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as regiões</SelectItem>
              {regions.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  Região {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={city}
            onValueChange={setCity}
            disabled={region === "all"}
          >
            <SelectTrigger className="filter-select">
              <SelectValue placeholder="Todas as cidades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as cidades</SelectItem>
              {cities.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={emailFilter}
            onValueChange={(value) => setEmailFilter(value as typeof emailFilter)}
          >
            <SelectTrigger className="filter-select">
              <SelectValue placeholder="E-mail" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os e-mails</SelectItem>
              <SelectItem value="with">Com e-mail</SelectItem>
              <SelectItem value="without">Sem e-mail</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={phoneFilter}
            onValueChange={(value) => setPhoneFilter(value as typeof phoneFilter)}
          >
            <SelectTrigger className="filter-select">
              <SelectValue placeholder="Telefone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os telefones</SelectItem>
              <SelectItem value="with">Com telefone</SelectItem>
              <SelectItem value="without">Sem telefone</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={mobileFilter}
            onValueChange={(value) => setMobileFilter(value as typeof mobileFilter)}
          >
            <SelectTrigger className="filter-select">
              <SelectValue placeholder="Celular" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os celulares</SelectItem>
              <SelectItem value="with">Com celular</SelectItem>
              <SelectItem value="without">Sem celular</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={companySizeFilter}
            onValueChange={(value) =>
              setCompanySizeFilter(value as typeof companySizeFilter)
            }
          >
            <SelectTrigger className="filter-select">
              <SelectValue placeholder="Porte" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os portes</SelectItem>
              <SelectItem value="ME">ME</SelectItem>
              <SelectItem value="EPP">EPP</SelectItem>
              <SelectItem value="Demais">Demais</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={clearFilters} disabled={!hasActiveFilters}>
            <X />
            Limpar filtros
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              const rows = filteredCompanies.map((company) => ({
                Nome: company.name,
                "Nome fantasia": company.tradeName || "",
                CNPJ: company.cnpj || "",
                Email: company.primaryEmail || "",
                Telefone: company.phone || "",
                Celular: company.mobile || "",
                Cidade: company.city || "",
                Estado: company.state || "",
                Região: company.region ? `Região ${company.region}` : "",
                Porte: company.companySize || "",
                Segmento: company.segment || "",
              }));

              const workbook = new ExcelJS.Workbook();
              const worksheet = workbook.addWorksheet("Empresas filtradas", {
                views: [{ state: "frozen", ySplit: 1 }],
              });
              const columns = Object.keys(rows[0] ?? {});

              worksheet.addTable({
                name: "EmpresasFiltradas",
                ref: "A1",
                headerRow: true,
                style: {
                  theme: "TableStyleMedium2",
                  showRowStripes: true,
                },
                columns: columns.map((name) => ({ name, filterButton: true })),
                rows: rows.map((row) => Object.values(row)),
              });

              worksheet.columns = [
                { width: 36 },
                { width: 34 },
                { width: 18 },
                { width: 30 },
                { width: 18 },
                { width: 18 },
                { width: 22 },
                { width: 12 },
                { width: 14 },
                { width: 14 },
                { width: 28 },
              ];
              worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
              worksheet.getRow(1).fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FF1F4E78" },
              };
              worksheet.getColumn(3).numFmt = "@";
              worksheet.getColumn(5).numFmt = "@";
              worksheet.getColumn(6).numFmt = "@";

              const content = await workbook.xlsx.writeBuffer();
              const blob = new Blob([content], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = `empresas-filtradas-${Date.now()}.xlsx`;
              document.body.appendChild(link);
              link.click();
              link.remove();
              URL.revokeObjectURL(url);
            }}
            disabled={!filteredCompanies.length}
          >
            <FileUp />
            Exportar
          </Button>
          <Button variant="outline" onClick={onImport}>
            <FileUp />
            Importar
          </Button>
          <span className="results-count">
            {filteredCompanies.length} resultados
          </span>
          </div>
        </div>
        {loading ? (
          <div className="table-loading">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : filteredCompanies.length ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Porte</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedCompanies.map((c) => (
                  <TableRow
                    key={c.id}
                    className="clickable-row"
                    onClick={() => onOpen(c.id)}
                  >
                    <TableCell>
                      <div className="company-cell">
                        <span>{c.name.slice(0, 2).toUpperCase()}</span>
                        <div>
                          <strong>{c.name}</strong>
                          <small>
                            {formatCnpj(c.cnpj) ||
                              c.tradeName ||
                              "CNPJ não informado"}
                          </small>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="stacked">
                        <span>{c.primaryEmail || "Sem e-mail"}</span>
                        <small className="phone-with-status">
                          {formatBrazilianPhone(c.mobile || c.phone) ||
                            "Sem telefone"}
                          {(c.mobile && c.mobileWhatsAppStatus === "YES") ||
                          (!c.mobile && c.phoneWhatsAppStatus === "YES") ? (
                            <span
                              className="whatsapp-confirmed"
                              title="WhatsApp confirmado"
                              aria-label="WhatsApp confirmado"
                            >
                              <MessageCircle />
                            </span>
                          ) : null}
                        </small>
                      </div>
                    </TableCell>
                    <TableCell>{c.companySize || "—"}</TableCell>
                    <TableCell>
                      {[
                        c.region ? `Região ${c.region}` : null,
                        [c.city, c.state].filter(Boolean).join(", "),
                      ]
                        .filter(Boolean)
                        .join(" • ") || "—"}
                    </TableCell>
                    <TableCell>
                      <span className={`status ${statusClass[c.status]}`}>
                        {statusLabel[c.status] || c.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <button
                        className="row-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(c.id, c.name);
                        }}
                        aria-label={`Excluir ${c.name}`}
                      >
                        <Trash2 />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="companies-pagination">
              <span>
                Exibindo {(page - 1) * pageSize + 1}–
                {Math.min(page * pageSize, filteredCompanies.length)} de{" "}
                {filteredCompanies.length}
              </span>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={page === 1}
                >
                  Anterior
                </Button>
                <span>
                  Página {page} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPage((value) => Math.min(totalPages, value + 1))
                  }
                  disabled={page === totalPages}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-table">
            <div>
              <Building2 />
            </div>
            <h2>
              {search ||
              region !== "all" ||
              city !== "all" ||
              emailFilter !== "all" ||
              phoneFilter !== "all" ||
              mobileFilter !== "all" ||
              companySizeFilter !== "all"
                ? "Nenhuma empresa encontrada"
                : "Sua base começa aqui"}
            </h2>
            <p>
              {search ||
              region !== "all" ||
              city !== "all" ||
              emailFilter !== "all" ||
              phoneFilter !== "all" ||
              mobileFilter !== "all" ||
              companySizeFilter !== "all"
                ? "Tente ajustar os filtros da base para encontrar registros compatíveis."
                : "Cadastre manualmente ou importe sua planilha para começar."}
            </p>
            {!search && (
              <div className="empty-actions">
                <Button onClick={onAdd}>
                  <Plus />
                  Cadastrar empresa
                </Button>
                <Button variant="outline" onClick={onImport}>
                  <FileUp />
                  Importar planilha
                </Button>
                {hasActiveFilters ? (
                  <Button variant="outline" onClick={clearFilters}>
                    <X />
                    Limpar filtros
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        )}
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
  if (view === "followups") return <FollowUpsPage />;
  if (view === "contacts") return <ContactsPage />;
  if (view === "settings") return <SettingsPage />;
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
