import type { ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Building2, CalendarClock, Check, ContactRound, Database, FileText, FileUp, History, Mail, Settings, Sparkles } from "lucide-react";
import { Brand, BrandGeometry, BrandSymbol } from "./brand";
import { CampaignPreview, CompaniesPreview, DashboardPreview, FollowUpsPreview } from "./platform-preview";
import styles from "./landing.module.css";
import { BrandScene } from "./three/brand-scene";
import { MotionSurface } from "./motion-surface";

function SectionHeading({ number, label, title, children }: { number: string; label: string; title: string; children?: ReactNode }) {
  return <div className={styles.sectionHeading}><p className={styles.eyebrow}><span>{number}</span> {label}</p><h2>{title}</h2>{children && <p className={styles.description}>{children}</p>}</div>;
}

export function Hero() {
  return <section id="inicio" className={styles.hero} aria-labelledby="hero-title" tabIndex={-1}>
    <div className={`${styles.container} ${styles.heroGrid}`}>
      <div className={styles.heroCopy}><p className={styles.eyebrow}><span /> CONEXÕES QUE MOVEM SUA OPERAÇÃO</p>
        <h1 id="hero-title">Conecte sua operação.<br /><em>Evolua cada relacionamento.</em></h1>
        <p className={styles.description}>A Conecta Core reúne empresas, contatos, campanhas e acompanhamentos em uma experiência organizada, fluida e integrada.</p>
        <div className={styles.actions}><a href="#apresentacao" className={styles.primary}>Conhecer a plataforma <ArrowRight aria-hidden="true" /></a><a href="#acesso" className={styles.textLink}>Acessar plataforma <ArrowRight aria-hidden="true" /></a></div>
      </div>
      <div className={styles.heroVisual}><BrandScene /><div className={styles.heroPreview}><DashboardPreview /></div><div className={styles.visualTag}><span /> Empresas. Pessoas. Possibilidades.</div></div>
    </div>
    <div className={`${styles.container} ${styles.heroBottom}`}><span>UM NÚCLEO. TODA A SUA OPERAÇÃO.</span><a href="#apresentacao">Explore a Conecta Core <ArrowDown aria-hidden="true" /></a><span>01 — 08</span></div>
  </section>;
}

export function OrganizationSection() {
  const nodes = [[Building2, "Empresas"], [ContactRound, "Contatos"], [Mail, "E-mails"], [CalendarClock, "Acompanhamentos"], [FileUp, "Importações"]] as const;
  return <section id="apresentacao" className={`${styles.section} ${styles.organization}`} aria-label="Do caos à organização">
    <div className={`${styles.container} ${styles.split}`}><SectionHeading number="02" label="TUDO SE CONECTA" title="Do caos à organização.">Informações espalhadas tornam a rotina mais complexa. Reúna os detalhes de cada relacionamento e encontre o próximo passo em um mesmo lugar.</SectionHeading>
      <MotionSurface kind="organization"><div className={styles.convergence} aria-label="Empresas, contatos, e-mails, acompanhamentos e importações reunidos na Conecta Core"><div className={styles.convergenceLines} aria-hidden="true" /><div className={styles.core}><BrandSymbol size={100} /><strong>Um núcleo conectado</strong></div>{nodes.map(([Icon, label], i) => <div className={styles.connectionNode} data-position={i} key={label}><Icon aria-hidden="true" /><span>{label}</span></div>)}</div></MotionSurface>
    </div>
  </section>;
}

export function OverviewSection() {
  return <section id="visao-geral" className={`${styles.section} ${styles.overview}`} aria-label="Visão geral"><div className={styles.container}>
    <div className={styles.centerHeading}><SectionHeading number="03" label="VISÃO GERAL" title="Clareza para acompanhar sua operação.">Do panorama aos detalhes: visualize sua base, acompanhe atividades e mantenha os próximos contatos no radar.</SectionHeading></div>
    <div className={styles.overviewPreview}><MotionSurface kind="dashboard"><DashboardPreview /></MotionSurface></div>
    <div className={styles.overviewLabels}><span><Building2 aria-hidden="true" /> Sua base organizada</span><span><History aria-hidden="true" /> Atividades em contexto</span><span><CalendarClock aria-hidden="true" /> Próximos passos visíveis</span></div>
  </div></section>;
}

function Benefits({ items }: { items: string[] }) {
  return <ul className={styles.benefits}>{items.map(item => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>;
}

export function FeatureSections() {
  return <>
    <section id="empresas" className={`${styles.section} ${styles.companies}`} aria-label="Empresas e contatos"><div className={`${styles.container} ${styles.split}`}>
      <div><SectionHeading number="04" label="EMPRESAS E CONTATOS" title="Empresas e contatos em um só lugar.">Cada empresa tem uma história. Mantenha seus dados, pessoas e interações próximos para dar contexto a cada nova conversa.</SectionHeading><Benefits items={["Encontre empresas com busca e filtros.", "Organize a base por região e cidade.", "Consulte contatos e histórico no mesmo contexto."]} /></div>
      <MotionSurface kind="companies"><CompaniesPreview /></MotionSurface>
    </div></section>
    <section id="campanhas" className={`${styles.section} ${styles.campaigns}`} aria-label="Campanhas e e-mails"><div className={`${styles.container} ${styles.split}`}>
      <div className={styles.featureVisual}><MotionSurface kind="campaigns"><CampaignPreview /></MotionSurface></div>
      <div><SectionHeading number="05" label="CAMPANHAS E E-MAILS" title="Comunicação organizada, do início ao acompanhamento.">Prepare a mensagem, escolha o público e acompanhe o progresso. Uma rotina de comunicação com mais organização em cada etapa.</SectionHeading><Benefits items={["Templates para dar consistência às mensagens.", "Revisão do público antes dos envios em lote.", "Histórico e progresso dos envios por campanha."]} /></div>
    </div></section>
    <section id="acompanhamentos" className={`${styles.section} ${styles.followups}`} aria-label="Follow-ups"><div className={`${styles.container} ${styles.split}`}>
      <div><SectionHeading number="06" label="FOLLOW-UPS" title="Acompanhe cada oportunidade até o próximo passo.">O relacionamento continua depois do primeiro contato. Registre o que aconteceu e organize quando retomar cada conversa.</SectionHeading><Benefits items={["Datas previstas e notas para cada acompanhamento.", "Pendências e conclusões claramente organizadas.", "Histórico para retomar a conversa com contexto."]} /></div>
      <MotionSurface kind="followups"><FollowUpsPreview /></MotionSurface>
    </div></section>
  </>;
}

export function ResourcesSection() {
  const resources = [
    [FileText, "Templates", "Mensagens e anexos organizados para reutilizar na comunicação."],
    [FileUp, "Importações", "Mapeamento de colunas e revisão dos dados antes de importar empresas."],
    [Sparkles, "Envios Inteligentes", "Preparação e revisão de destinatários antes de autorizar o envio."],
    [Database, "Organização de dados", "Regiões, cidades, portes e status para estruturar sua base."],
    [Settings, "Configurações", "Preferências e ajustes da operação reunidos no workspace."],
    [History, "Histórico", "Registros de comunicação para acompanhar cada relacionamento."],
  ] as const;
  return <section id="recursos" className={`${styles.section} ${styles.resources}`} aria-label="Plataforma completa"><div className={styles.container}>
    <div className={styles.resourceIntro}><SectionHeading number="07" label="PLATAFORMA COMPLETA" title="Tudo o que sua operação precisa, em um mesmo núcleo.">Recursos que se complementam para organizar o trabalho, da entrada dos dados ao acompanhamento.</SectionHeading><BrandSymbol size={130} /></div>
    <MotionSurface kind="resources"><div className={styles.resourceGrid}>{resources.map(([Icon, title, description], i) => <article key={title}><div><Icon aria-hidden="true" /><span>0{i + 1}</span></div><h3>{title}</h3><p>{description}</p></article>)}</div></MotionSurface>
  </div></section>;
}

export function AccessSection({ accessHref }: { accessHref: string }) {
  return <section id="acesso" className={`${styles.section} ${styles.access}`} aria-labelledby="access-title"><div className={`${styles.container} ${styles.accessGrid}`}>
    <div className={styles.accessArt}><BrandGeometry /><p>O próximo passo<br /><strong>começa com uma conexão.</strong></p></div>
    <div className={styles.accessCard}><Brand /><p className={styles.eyebrow}>08 / SEU WORKSPACE</p><h2 id="access-title">Entre na Conecta Core</h2><p>Empresas, contatos e acompanhamentos em um espaço para dar continuidade à sua operação.</p><a className={styles.primary} href={accessHref}>Continuar ao workspace <ArrowRight aria-hidden="true" /></a><a className={styles.textLink} href="#inicio"><ArrowLeft aria-hidden="true" /> Voltar à apresentação</a></div>
  </div></section>;
}
