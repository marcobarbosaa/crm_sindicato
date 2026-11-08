import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, Building2, CalendarClock, ContactRound, Database, FileText, FileUp, History, Mail, Settings, Sparkles, Check } from "lucide-react";
import { BrandGeometry, BrandSymbol } from "./brand";
import { DashboardPreview } from "./platform-preview";
import styles from "./landing.module.css";
import { BrandScene } from "./three/brand-scene";
import { MotionSurface } from "./motion-surface";
import { ScrollScene } from "./scroll-scene";

function SectionHeading({ number, label, title, children }: { number: string; label: string; title: string; children?: ReactNode }) {
  return <MotionSurface kind="editorial"><div className={styles.sectionHeading}><p className={styles.eyebrow}><span>{number}</span> {label}</p><h2>{title}</h2>{children && <p className={styles.description}>{children}</p>}</div></MotionSurface>;
}

export function Hero() {
  return <section id="inicio" className={styles.hero} aria-labelledby="hero-title" tabIndex={-1}>
    <div className={styles.container}>
      <div className={styles.heroGrid}>
        <div className={styles.heroCopy}><p className={styles.eyebrow}><span /> GESTÃO E RELACIONAMENTO EMPRESARIAL</p><h1 id="hero-title">Todas as suas conexões.<br /><em>Uma operação mais inteligente.</em></h1></div>
        <div className={styles.heroIntro}><p className={styles.description}>Organize empresas, centralize contatos, gerencie campanhas e acompanhe cada oportunidade em uma única plataforma.</p><div className={styles.actions}><a href="/workspace" className={styles.primary}>Acessar Conecta Core <ArrowRight aria-hidden="true" /></a><a href="#visao-geral" className={styles.textLink}>Explorar a plataforma <ArrowDown aria-hidden="true" /></a></div></div>
      </div>
      <div className={styles.heroVisual}><ScrollScene kind="hero">
        <div className={styles.heroProduct}><div className={styles.productChrome}><span><i /> CONECTA CORE / WORKSPACE</span><span>Uma operação conectada</span></div><div className={styles.heroPreview}><DashboardPreview /></div></div>
        <aside className={styles.heroAside} aria-label="Exemplo de continuidade do relacionamento"><BrandScene /><div className={styles.floatingContact}><span className={styles.miniLabel}>CONEXÃO EM FOCO · DEMONSTRAÇÃO</span><div><span className={styles.companyAvatar}>MC</span><p><strong>Marina Costa</strong><small>Aurora Tecnologia</small></p></div><span className={styles.connectionStatus}><Check aria-hidden="true" /> Contato vinculado à empresa</span></div><div className={styles.floatingNext}><CalendarClock aria-hidden="true" /><div><span>PRÓXIMO PASSO</span><strong>Retomar a conversa</strong><small>03 nov · Acompanhamento demonstrativo</small></div></div></aside>
      </ScrollScene></div>
      <div className={styles.heroBottom}><span>EMPRESAS → PESSOAS → CONVERSAS → CONTINUIDADE</span><a href="#apresentacao">Veja como tudo se conecta <ArrowDown aria-hidden="true" /></a></div>
    </div>
  </section>;
}

export function OrganizationSection() {
  const nodes = [[Building2, "Empresas", "Uma base dispersa"], [ContactRound, "Contatos", "Pessoas sem contexto"], [Mail, "E-mails", "Conversas separadas"], [CalendarClock, "Retornos", "Próximos passos"], [FileUp, "Importações", "Dados de várias fontes"]] as const;
  return <section id="apresentacao" className={`${styles.section} ${styles.organization}`} aria-label="Da fragmentação à convergência"><div className={styles.container}>
    <div className={styles.narrativeRail}><span>01 / FRAGMENTAÇÃO</span><span>02 / CONVERGÊNCIA</span><span>03 / OPERAÇÃO</span><span>04 / CONTINUIDADE</span></div>
    <div className={styles.split}><SectionHeading number="01 — 02" label="DO DISPERSO AO CONECTADO" title="Informações separadas. Uma visão que conecta.">Uma empresa na planilha. Um contato no e-mail. Um retorno para lembrar. A Conecta Core aproxima essas informações para que a próxima conversa comece com contexto.</SectionHeading>
      <ScrollScene kind="organization"><div className={styles.convergence} aria-label="Empresas, contatos, e-mails, retornos e importações convergem para a Conecta Core"><div className={styles.convergenceLines} aria-hidden="true" /><div className={styles.core}><BrandSymbol size={90} /><strong>CONECTA CORE</strong><span>Contexto em comum</span></div>{nodes.map(([Icon, label, detail], i) => <div className={styles.connectionNode} data-position={i} key={label}><Icon aria-hidden="true" /><div><strong>{label}</strong><small>{detail}</small></div></div>)}</div></ScrollScene>
    </div><a className={styles.narrativeNext} href="#visao-geral"><span>Do contexto à ação.</span> Explore a operação por dentro <ArrowDown aria-hidden="true" /></a>
  </div></section>;
}

export function HowItWorksSection() {
  const steps = [
    [FileUp, "Importe", "Organize os dados iniciais das empresas.", "Arquivo → mapeamento → revisão", "#recursos"],
    [Building2, "Centralize", "Reúna empresas, contatos e informações importantes.", "Empresa + pessoas + contexto", "#empresas"],
    [Mail, "Comunique", "Prepare campanhas e acompanhe os envios.", "Público → mensagem → acompanhamento", "#campanhas"],
    [CalendarClock, "Acompanhe", "Organize retornos e dê continuidade aos relacionamentos.", "Histórico → próxima conversa", "#acompanhamentos"],
  ] as const;
  return <section id="como-funciona" className={`${styles.section} ${styles.howItWorks}`} aria-labelledby="workflow-title"><div className={styles.container}>
    <div className={styles.workflowIntro}><p className={styles.eyebrow}>DA PRIMEIRA INFORMAÇÃO À PRÓXIMA CONVERSA</p><h2 id="workflow-title">Uma rotina que<br /><em>segue conectada.</em></h2><p>Quatro movimentos. Um fluxo de trabalho com continuidade.</p></div>
    <MotionSurface kind="resources"><ol className={styles.workflow}>{steps.map(([Icon, title, description, detail, href], i) => <li key={title}><span className={styles.workflowNumber}>0{i + 1}</span><div><Icon aria-hidden="true" /><h3>{title}</h3><p>{description}</p><span className={styles.workflowDetail}>{detail}</span><a href={href} aria-label={`Explorar: ${title}`}><ArrowRight aria-hidden="true" /></a></div></li>)}</ol></MotionSurface>
  </div></section>;
}

export function ResourcesSection() {
  const resources = [
    [FileUp, "Importações", "Sua base começa bem organizada.", "Mapeie colunas e revise os dados antes de importar empresas.", "Arquivo de origem → colunas → revisão"],
    [Sparkles, "Envios Inteligentes", "Prepare. Revise. Autorize.", "Organize os destinatários e revise a preparação antes de autorizar o envio.", "Preparação → revisão → autorização"],
    [FileText, "Templates", "Consistência em cada mensagem.", "Mensagens e anexos organizados para reutilizar na comunicação.", "Assunto + mensagem + anexos"],
    [Database, "Organização de dados", "Uma base que faz sentido.", "Regiões, cidades, portes e status para estruturar sua base.", "Região / cidade / porte / status"],
    [Settings, "Configurações", "Ajustes no mesmo lugar.", "Preferências e ajustes da operação reunidos no workspace.", "Preferências da operação"],
    [History, "Histórico", "Contexto para continuar.", "Registros de comunicação para acompanhar cada relacionamento.", "O que aconteceu → o que vem depois"],
  ] as const;
  return <section id="recursos" className={`${styles.section} ${styles.resources}`} aria-label="Recursos complementares"><div className={styles.container}>
    <div className={styles.resourceIntro}><SectionHeading number="+" label="ALÉM DO ESSENCIAL" title="Os detalhes também se conectam.">Da entrada de dados à comunicação: recursos que sustentam o trabalho de todos os dias.</SectionHeading><BrandSymbol size={100} /></div>
    <MotionSurface kind="resources"><div className={styles.resourceGrid}>{resources.map(([Icon, title, headline, description, detail], i) => <article key={title}><div><Icon aria-hidden="true" /><span>0{i + 1} / {title}</span></div><h3>{headline}</h3><p>{description}</p><details className={styles.resourceDetails}><summary>Explorar {title}<ArrowRight aria-hidden="true" /></summary><p>{detail}</p></details></article>)}</div></MotionSurface>
  </div></section>;
}

export function AccessSection({ accessHref }: { accessHref: string }) {
  return <section id="acesso" className={`${styles.section} ${styles.access}`} aria-labelledby="access-title"><div className={`${styles.container} ${styles.accessGrid}`}>
    <div className={styles.accessCard}><p className={styles.eyebrow}>CONECTA CORE / SUA OPERAÇÃO, EM CONTINUIDADE</p><h2 id="access-title">Sua próxima conexão<br /><em>começa aqui.</em></h2><p>Empresas, pessoas e próximos passos. Reunidos para você seguir em frente.</p><a className={styles.primary} href={accessHref}>Entrar na plataforma <ArrowRight aria-hidden="true" /></a></div><div className={styles.accessArt}><BrandGeometry /></div>
  </div></section>;
}
