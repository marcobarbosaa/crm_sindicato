"use client";

import { useId, useState } from "react";
import { Search, ContactRound, Check, FileText, CalendarClock, ArrowRight } from "lucide-react";
import styles from "./landing.module.css";

// Deliberately self-contained fixtures: no CRM imports, fetches or persistence.
const companies = [
  { initials: "AT", name: "Aurora Tecnologia", city: "São Paulo", region: "Região 01", status: "Contatado", contact: "Marina Costa", history: "Apresentação enviada em 28/10/2026.", next: "Conversar sobre a atuação da empresa." },
  { initials: "HS", name: "Horizonte Serviços", city: "Campinas", region: "Região 01", status: "Em negociação", contact: "Rafael Lima", history: "Proposta apresentada em 28/10/2026.", next: "Retomar a proposta em 30/10/2026." },
  { initials: "VC", name: "Vértice Comércio", city: "Santos", region: "Região 02", status: "Não contatado", contact: "Ana Martins", history: "Contato incluído em 27/10/2026.", next: "Preparar a primeira conversa." },
];

export function CompaniesDemo() {
  const id = useId();
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [selected, setSelected] = useState(companies[0]);
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const visible = companies.filter(company => (!city || company.city === city) && (!region || company.region === region) && normalize(company.name + " " + company.contact).includes(normalize(query)));
  return <div data-demo="companies">
    <label className={styles.mockSearch}><Search aria-hidden="true" /><input aria-label="Buscar empresa ou contato na demonstração" placeholder="Buscar empresa ou contato" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className={styles.filters}><label>Região<select value={region} onChange={event => setRegion(event.target.value)}><option value="">Todas</option><option>Região 01</option><option>Região 02</option></select></label><label>Cidade<select value={city} onChange={event => setCity(event.target.value)}><option value="">Todas</option>{companies.map(company => <option key={company.city}>{company.city}</option>)}</select></label><span aria-live="polite">{visible.length} empresas</span></div>
    <div className={styles.companyResults}><ul className={styles.companyList}>{visible.map(company => <li key={company.name}><button type="button" aria-pressed={selected.name === company.name} aria-controls={id} onClick={() => setSelected(company)}><span className={styles.companyAvatar}>{company.initials}</span><span><strong>{company.name}</strong><small>{company.city} · {company.region}</small></span><span className={styles.badge}>{company.status}</span><ArrowRight aria-hidden="true" /></button></li>)}</ul>{!visible.length && <p className={styles.emptyDemo}>Nenhuma empresa neste filtro. Altere a busca para explorar os exemplos.</p>}</div>
    <div id={id} className={styles.contactCard} aria-live="polite" aria-atomic="true"><ContactRound aria-hidden="true" /><div><span className={styles.miniLabel}>CONTATO VINCULADO · {selected.name}</span><strong>{selected.contact}</strong><p>{selected.history}</p><small>Próxima ação: {selected.next}</small></div></div>
    <p className={styles.demoHint}>Selecione uma empresa para explorar seu contexto. Dados fictícios.</p>
  </div>;
}

const campaignSteps = ["Público", "Mensagem", "Revisão", "Progresso", "Histórico"];
export function CampaignDemo() {
  const [step, setStep] = useState(1);
  const id = useId();
  return <div data-demo="campaign">
    <div className={styles.previewHeading}><span>CAMPANHA DEMONSTRATIVA</span><strong>Novas conexões, bem preparadas.</strong></div>
    <div className={styles.campaignSteps} role="group" aria-label="Etapas da campanha demonstrativa">{campaignSteps.map((label, i) => <button key={label} type="button" aria-pressed={step === i} aria-controls={id} onClick={() => setStep(i)}><span>0{i + 1}</span>{label}</button>)}</div>
    <div id={id} className={styles.campaignStage} aria-live="polite" aria-atomic="true">
      {step === 0 && <><span className={styles.miniLabel}>01 / ESCOLHA DO PÚBLICO</span><h3>Empresas da Região 01</h3><p>Exemplo de público: 50 destinatários selecionados para uma apresentação institucional.</p><div className={styles.audienceTokens}><span>Aurora Tecnologia</span><span>Horizonte Serviços</span><span>+ outros exemplos</span></div><p>Revise empresas e contatos antes de seguir.</p></>}
      {step === 1 && <div className={styles.messagePreview}><FileText aria-hidden="true" /><div><small>02 / MENSAGEM · TEMPLATE INSTITUCIONAL</small><strong>Vamos construir novas conexões?</strong><p>Olá, Marina. Gostaríamos de apresentar nossa atuação e conhecer melhor a sua empresa.</p><span className={styles.messageSignature}>Equipe de relacionamento<br />Conecta Core · exemplo</span></div></div>}
      {step === 2 && <><span className={styles.miniLabel}>03 / REVISÃO ANTES DO ENVIO</span><h3>Uma última visão do conjunto.</h3><ul className={styles.reviewList}>{["50 destinatários de exemplo", "Assunto e mensagem preparados", "Público da Região 01 selecionado"].map(item => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul><p>Esta prévia não autoriza nem realiza envios.</p></>}
      {step === 3 && <><span className={styles.miniLabel}>04 / ESTADO FICTÍCIO DE ENVIO</span><h3>Progresso dos envios</h3><div className={styles.sendProgress}><div><strong>30 de 50 processados</strong><span>60%</span></div><meter min={0} max={50} value={30} aria-label="Demonstração: 30 de 50 envios processados" /><div><span>28 enviados</span><span>2 falhas</span><span>20 pendentes</span></div></div></>}
      {step === 4 && <><span className={styles.miniLabel}>05 / HISTÓRICO DEMONSTRATIVO</span><h3>Cada envio deixa contexto.</h3><ul className={styles.campaignHistory}><li><span>Aurora Tecnologia</span><span className={styles.badge}>Enviado · 10:40</span></li><li><span>Horizonte Serviços</span><span className={styles.badge}>Enviado · 10:42</span></li><li><span>Exemplo de falha</span><span className={styles.badge}>Falha · 10:43</span></li></ul></>}
    </div>
    <p className={styles.previewNote}><Check aria-hidden="true" />Explore as etapas. Simulação local, sem envio de e-mails.</p>
  </div>;
}

const followups = [
  { day: "30", month: "OUT", company: "Horizonte Serviços", action: "Retomar proposta comercial", date: "30/10/2026", history: "Proposta apresentada em 28/10/2026.", next: "Confirmar recebimento e combinar o próximo contato." },
  { day: "03", month: "NOV", company: "Aurora Tecnologia", action: "Conversar com o novo contato", date: "03/11/2026", history: "Apresentação enviada à Marina em 28/10/2026.", next: "Conhecer a atuação da empresa e registrar a conversa." },
  { day: "28", month: "OUT", company: "Vértice Comércio", action: "Apresentação institucional", date: "28/10/2026", history: "Apresentação concluída em 28/10/2026.", next: "Consultar o histórico antes de uma nova abordagem." },
];
export function FollowUpsDemo() {
  const [selected, setSelected] = useState(0);
  const [completed, setCompleted] = useState([false, false, true]);
  const id = useId();
  const item = followups[selected];
  return <div data-demo="followups"><div className={styles.previewHeading}><span>CONTINUIDADE DO RELACIONAMENTO</span><strong>A próxima conversa já tem contexto.</strong></div>
    <ul className={styles.followList}>{followups.map((followup, i) => <li key={followup.company}><button type="button" aria-pressed={selected === i} aria-controls={id} onClick={() => setSelected(i)}><span className={styles.dateTile}><b>{followup.day}</b>{followup.month}</span><span><strong>{followup.company}</strong><small>{followup.action}</small></span><span className={styles.badge}>{completed[i] ? "Concluído" : "Pendente"}</span></button></li>)}</ul>
    <div id={id} className={styles.followDetail}><div aria-live="polite" aria-atomic="true"><span className={styles.miniLabel}>PRÓXIMA AÇÃO · {item.date}</span><p>{item.next}</p><small>Histórico: {item.history}</small></div><button type="button" className={styles.demoAction} onClick={() => setCompleted(previous => previous.map((value, i) => i === selected ? !value : value))}><CalendarClock aria-hidden="true" />{completed[selected] ? "Reabrir exemplo" : "Concluir exemplo"}</button></div>
    <p className={styles.demoHint} role="status">{completed[selected] ? "Concluído" : "Pendente"} nesta demonstração. Alterações locais, sem salvar no CRM.</p>
  </div>;
}
