import type { ReactNode } from "react";
import { Building2, CalendarClock, Check, ContactRound, FileText, LayoutDashboard, Mail, Search, Send, SlidersHorizontal } from "lucide-react";
import { BrandSymbol } from "./brand";
import styles from "./landing.module.css";

function PreviewFrame({ title, children }: { title: string; children: ReactNode }) {
  return <figure className={styles.preview}>
    <figcaption className={styles.previewCaption}><span>{title}</span><span>Dados de demonstração · prévia estática</span></figcaption>
    <div className={styles.previewShell}>
      <div className={styles.previewRail} aria-hidden="true"><BrandSymbol size={34} />{[LayoutDashboard, Building2, ContactRound, Mail, CalendarClock].map((Icon, i) => <span key={i}><Icon /></span>)}</div>
      <div className={styles.previewBody}>{children}</div>
    </div>
  </figure>;
}

export function DashboardPreview() {
  const metrics = [{ Icon: Building2, label: "Empresas", value: "128" }, { Icon: Send, label: "Envios na semana", value: "46" }, { Icon: CalendarClock, label: "Follow-ups", value: "12" }];
  return <PreviewFrame title="Visão geral">
    <div className={styles.previewHeading}><span>SEU NÚCLEO DE RELACIONAMENTOS</span><strong>Uma visão clara do seu dia.</strong><p>Empresas, atividades e próximos contatos.</p></div>
    <div className={styles.metrics}>{metrics.map(({ Icon, label, value }) => <div key={label}><Icon aria-hidden="true" /><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className={styles.dashboardBottom}>
      <div className={styles.previewPanel}><strong>Atividades recentes</strong><ul className={styles.activityList}><li><Mail aria-hidden="true" /><span>E-mail enviado<small>Aurora Tecnologia · 10:40</small></span></li><li><ContactRound aria-hidden="true" /><span>Contato cadastrado<small>Marina Costa · 09:30</small></span></li><li><CalendarClock aria-hidden="true" /><span>Acompanhamento criado<small>Horizonte Serviços · 09:15</small></span></li></ul></div>
      <div className={styles.previewPanel}><strong>Próximos contatos</strong><div className={styles.nextContact}><span>30 OUT</span><b>Horizonte Serviços</b><p>Retomar a conversa sobre a proposta.</p><span className={styles.badge}>Pendente</span></div></div>
    </div>
  </PreviewFrame>;
}

export function CompaniesPreview() {
  return <PreviewFrame title="Empresas e contatos">
    <div className={styles.mockSearch}><Search aria-hidden="true" /><span>Buscar empresa ou contato</span><SlidersHorizontal aria-hidden="true" /></div>
    <div className={styles.filters}><span>Região 01</span><span>São Paulo</span><span>Todos os status</span></div>
    <ul className={styles.companyList}>{[["AT", "Aurora Tecnologia", "São Paulo · Região 01", "Contatado"], ["HS", "Horizonte Serviços", "São Paulo · Região 01", "Em negociação"], ["VC", "Vértice Comércio", "São Paulo · Região 01", "Não contatado"]].map(([initials, name, location, status]) => <li key={name}><span className={styles.companyAvatar}>{initials}</span><span><strong>{name}</strong><small>{location}</small></span><span className={styles.badge}>{status}</span></li>)}</ul>
    <div className={styles.contactCard}><ContactRound aria-hidden="true" /><div><strong>Marina Costa</strong><p>Contato · Aurora Tecnologia</p><small>Histórico: apresentação enviada em 28/10/2026.</small></div></div>
  </PreviewFrame>;
}

export function CampaignPreview() {
  return <PreviewFrame title="Campanhas e e-mails">
    <div className={styles.previewHeading}><span>CAMPANHA DEMONSTRATIVA</span><strong>Apresentação institucional</strong><p>Template selecionado · empresas da Região 01</p></div>
    <div className={styles.messagePreview}><FileText aria-hidden="true" /><div><small>ASSUNTO</small><strong>Vamos construir novas conexões?</strong><p>Olá, Marina. Gostaríamos de apresentar nossa atuação e conhecer melhor a sua empresa.</p></div></div>
    <div className={styles.sendProgress}><div><strong>Progresso dos envios</strong><span>30 de 50 processados</span></div><meter min={0} max={50} value={30} aria-label="Demonstração: 30 de 50 envios processados" /><div><span>28 enviados</span><span>2 falhas</span><span>20 pendentes</span></div></div>
    <div className={styles.previewNote}><Check aria-hidden="true" /><span>Histórico de envios reunido na campanha.</span></div>
  </PreviewFrame>;
}

export function FollowUpsPreview() {
  return <PreviewFrame title="Acompanhamentos">
    <div className={styles.previewHeading}><span>AGENDA DE RELACIONAMENTOS</span><strong>Cada conversa tem continuidade.</strong></div>
    <ul className={styles.followList}>{[["30", "OUT", "Horizonte Serviços", "Retomar proposta comercial", "Pendente"], ["03", "NOV", "Aurora Tecnologia", "Conversar com o novo contato", "Pendente"], ["28", "OUT", "Vértice Comércio", "Apresentação institucional realizada", "Concluído"]].map(([day, month, company, action, status]) => <li key={company}><span className={styles.dateTile}><b>{day}</b>{month}</span><div><strong>{company}</strong><p>{action}</p><small>Data prevista: {day}/{month === "OUT" ? "10" : "11"}/2026</small></div><span className={styles.badge}>{status}</span></li>)}</ul>
    <div className={styles.previewNote}><CalendarClock aria-hidden="true" /><span>Histórico · proposta enviada à Horizonte em 28/10/2026.</span></div>
  </PreviewFrame>;
}
