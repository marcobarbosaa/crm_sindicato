import type { ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Building2, CalendarClock, ContactRound, Database, FileText, FileUp, History, Mail, Settings, Sparkles } from "lucide-react";
import { Brand, BrandGeometry, BrandSymbol } from "./brand";
import { DashboardPreview } from "./platform-preview";
import styles from "./landing.module.css";
import { BrandScene } from "./three/brand-scene";
import { MotionSurface } from "./motion-surface";
import { ScrollScene } from "./scroll-scene";

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
      <div className={styles.heroVisual}><ScrollScene kind="hero"><BrandScene /><div className={styles.heroPreview}><DashboardPreview /></div><div className={styles.visualTag}><span /> Empresas. Pessoas. Possibilidades.</div></ScrollScene></div>
    </div>
    <div className={`${styles.container} ${styles.heroBottom}`}><span>UM NÚCLEO. TODA A SUA OPERAÇÃO.</span><a href="#apresentacao">Explore a Conecta Core <ArrowDown aria-hidden="true" /></a><span>01 — 08</span></div>
  </section>;
}

export function OrganizationSection() {
  const nodes = [[Building2, "Empresas"], [ContactRound, "Contatos"], [Mail, "E-mails"], [CalendarClock, "Acompanhamentos"], [FileUp, "Importações"]] as const;
  return <section id="apresentacao" className={`${styles.section} ${styles.organization}`} aria-label="Do caos à organização">
    <div className={`${styles.container} ${styles.split}`}><SectionHeading number="02" label="TUDO SE CONECTA" title="Do caos à organização.">Informações espalhadas tornam a rotina mais complexa. Reúna os detalhes de cada relacionamento e encontre o próximo passo em um mesmo lugar.</SectionHeading>
      <ScrollScene kind="organization"><div className={styles.convergence} aria-label="Empresas, contatos, e-mails, acompanhamentos e importações reunidos na Conecta Core"><div className={styles.convergenceLines} aria-hidden="true" /><div className={styles.core}><BrandSymbol size={100} /><strong>Um núcleo conectado</strong></div>{nodes.map(([Icon, label], i) => <div className={styles.connectionNode} data-position={i} key={label}><Icon aria-hidden="true" /><span>{label}</span></div>)}</div></ScrollScene>
    </div>
  </section>;
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
