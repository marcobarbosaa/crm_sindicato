import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { DashboardPreview, CompaniesPreview, CampaignPreview, FollowUpsPreview } from "./platform-preview";
import { ProductStoryMotion } from "./product-story-motion";
import styles from "./landing.module.css";

const chapters = [
  {
    id: "visao-geral", short: "Visão Geral", label: "VISÃO GERAL",
    title: "Clareza para acompanhar sua operação.",
    description: "Do panorama aos detalhes: visualize sua base, acompanhe atividades e mantenha os próximos contatos no radar.",
    benefits: ["Sua base organizada", "Atividades em contexto", "Próximos passos visíveis"],
    Preview: DashboardPreview,
  },
  {
    id: "empresas", short: "Empresas", label: "EMPRESAS E CONTATOS",
    title: "Empresas e contatos em um só lugar.",
    description: "Cada empresa tem uma história. Mantenha seus dados, pessoas e interações próximos para dar contexto a cada nova conversa.",
    benefits: ["Encontre empresas com busca e filtros.", "Organize a base por região e cidade.", "Consulte contatos e histórico no mesmo contexto."],
    Preview: CompaniesPreview,
  },
  {
    id: "campanhas", short: "Campanhas", label: "CAMPANHAS E E-MAILS",
    title: "Comunicação organizada, do início ao acompanhamento.",
    description: "Prepare a mensagem, escolha o público e acompanhe o progresso. Uma rotina de comunicação com mais organização em cada etapa.",
    benefits: ["Templates para dar consistência às mensagens.", "Revisão do público antes dos envios em lote.", "Histórico e progresso dos envios por campanha."],
    Preview: CampaignPreview,
  },
  {
    id: "acompanhamentos", short: "Follow-ups", label: "FOLLOW-UPS",
    title: "Acompanhe cada oportunidade até o próximo passo.",
    description: "O relacionamento continua depois do primeiro contato. Registre o que aconteceu e organize quando retomar cada conversa.",
    benefits: ["Datas previstas e notas para cada acompanhamento.", "Pendências e conclusões claramente organizadas.", "Histórico para retomar a conversa com contexto."],
    Preview: FollowUpsPreview,
  },
];

export function ProductStory() {
  return <ProductStoryMotion>
    <nav className={styles.storyNav} aria-label="Capítulos da demonstração">
      <span>EXPLORE A PLATAFORMA</span>
      <ol>{chapters.map((chapter, i) => <li key={chapter.id}><a data-story-link="" href={"#" + chapter.id}><b>0{i + 1}</b><span>{chapter.short}</span></a></li>)}</ol>
    </nav>
    <div className={styles.storyTrack}>
      {chapters.map(({ id, label, title, description, benefits, Preview }, i) => <section key={id} className={styles.storyChapter} aria-labelledby={id + "-title"} style={{ "--chapter-row": i + 1 } as CSSProperties}>
        <div id={id} data-story-copy="" className={styles.storyCopy} tabIndex={-1}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}><span>0{i + 3}</span>{label}</p>
            <p className={styles.chapterNumber}>0{i + 1} <span>/ 04</span></p>
            <h2 id={id + "-title"}>{title}</h2>
            <p className={styles.description}>{description}</p>
          </div>
          <ul className={styles.benefits}>{benefits.map(item => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
        </div>
        <div data-story-panel={id} className={styles.storyPanel}>
          <div className={styles.storyPanelLabel}><span>CONEXÕES EM CONTINUIDADE</span><span>0{i + 1} / 04</span></div>
          <Preview />
        </div>
      </section>)}
    </div>
  </ProductStoryMotion>;
}
