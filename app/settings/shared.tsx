import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function SettingsSection({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description?: string; children: ReactNode }) {
  return <section className="preferences-card">
    <header><span className="preferences-icon"><Icon aria-hidden="true" /></span><div><h3>{title}</h3>{description && <p>{description}</p>}</div></header>
    <div className="preferences-card-body">{children}</div>
  </section>;
}
export function LoadingSettings() {
  return <div className="preferences-loading" role="status" aria-label="Carregando configurações">
    <Skeleton className="h-6 w-48" />{[1, 2, 3].map(id => <Skeleton key={id} className="h-36 w-full" />)}
    <span className="sr-only">Carregando…</span>
  </div>;
}
export function SettingsError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="preferences-empty" role="alert"><AlertCircle /><h3>Não foi possível carregar</h3><p>{message}</p><Button variant="outline" onClick={retry}><RefreshCw />Tentar novamente</Button></div>;
}
export function StatList({ items }: { items: [string, number | string][] }) {
  return <dl className="preferences-stats">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</dd></div>)}</dl>;
}
export function formatDate(value: string, timezone = "America/Sao_Paulo") {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}
