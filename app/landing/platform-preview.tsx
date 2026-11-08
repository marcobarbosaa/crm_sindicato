import type { ReactNode } from "react";
import { Building2, CalendarClock, ContactRound, LayoutDashboard, Mail, Send } from "lucide-react";
import { BrandSymbol } from "./brand";
import styles from "./landing.module.css";
import { MotionSurface } from "./motion-surface";
import { CompaniesDemo, CampaignDemo, FollowUpsDemo } from "./demo-interactions";

function PreviewFrame({ title, children }: { title: string; children: ReactNode }) {
  return <figure className={styles.preview}>
    <figcaption className={styles.previewCaption}><span>{title}</span><span>Dados fictícios · demonstração</span></figcaption>
    <div className={styles.previewShell}>
      <div className={styles.previewRail} aria-hidden="true"><BrandSymbol size={34} />{[LayoutDashboard, Building2, ContactRound, Mail, CalendarClock].map((Icon, i) => <span key={i}><Icon /></span>)}</div>
      <div className={styles.previewBody}>{children}</div>
    </div>
  </figure>;
}

export function DashboardPreview() {
  const metrics = [{ Icon: Building2, label: "Empresas", value: "128" }, { Icon: Send, label: "Envios na semana", value: "46" }, { Icon: CalendarClock, label: "Follow-ups", value: "12" }];
  return <MotionSurface kind="dashboard"><PreviewFrame title="Visão geral">
    <div className={styles.previewHeading}><span>SEU NÚCLEO DE RELACIONAMENTOS</span><strong>Uma visão clara do seu dia.</strong><p>Empresas, atividades e próximos contatos.</p></div>
    <div className={styles.metrics}>{metrics.map(({ Icon, label, value }) => <div key={label} data-reveal=""><Icon aria-hidden="true" /><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className={styles.dashboardBottom}>
      <div className={styles.previewPanel} data-reveal=""><strong>Atividades recentes</strong><ul className={styles.activityList}><li><Mail aria-hidden="true" /><span>E-mail enviado<small>Aurora Tecnologia · 10:40</small></span></li><li><ContactRound aria-hidden="true" /><span>Contato cadastrado<small>Marina Costa · 09:30</small></span></li><li><CalendarClock aria-hidden="true" /><span>Acompanhamento criado<small>Horizonte Serviços · 09:15</small></span></li></ul></div>
      <div className={styles.previewPanel} data-reveal=""><strong>Próximos contatos</strong><div className={styles.nextContact}><span>30 OUT</span><b>Horizonte Serviços</b><p>Retomar a conversa sobre a proposta.</p><span className={styles.badge}>Pendente</span></div></div>
    </div>
  </PreviewFrame></MotionSurface>;
}

export function CompaniesPreview() {
  return <PreviewFrame title="Empresas e contatos"><CompaniesDemo /></PreviewFrame>;
}
export function CampaignPreview() {
  return <PreviewFrame title="Campanhas e e-mails"><CampaignDemo /></PreviewFrame>;
}
export function FollowUpsPreview() {
  return <PreviewFrame title="Acompanhamentos"><FollowUpsDemo /></PreviewFrame>;
}
