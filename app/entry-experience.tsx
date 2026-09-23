"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  ContactRound,
  Mail,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type EntryExperienceProps = {
  user: { displayName: string; email: string } | null;
  accessHref: string;
};

function initials(value: string) {
  const parts = value.replace(/@.*$/, "").trim().split(/[\s._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "P";
}

export function EntryExperience({ user, accessHref }: EntryExperienceProps) {
  const stageRef = useRef<HTMLElement>(null);
  const loginTitleRef = useRef<HTMLHeadingElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const stage = stageRef.current;
      if (!stage || window.matchMedia("(max-width: 760px)").matches) return;
      const distance = Math.max(1, stage.offsetHeight - window.innerHeight);
      setProgress(Math.min(1, Math.max(0, (window.scrollY - stage.offsetTop) / distance)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const goTo = useCallback((scene: "intro" | "login", focus = false) => {
    const stage = stageRef.current;
    if (!stage) return;
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const target = mobile
      ? scene === "login"
        ? document.getElementById("acesso")?.offsetTop ?? 0
        : 0
      : stage.offsetTop + (scene === "login" ? stage.offsetHeight - window.innerHeight : 0);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: target, behavior: reducedMotion ? "auto" : "smooth" });
    if (focus && scene === "login") window.setTimeout(() => loginTitleRef.current?.focus(), 650);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowDown", "ArrowRight", "PageDown"].includes(event.key) && progress < 0.95) {
        event.preventDefault();
        goTo("login", true);
      }
      if (["ArrowUp", "ArrowLeft", "PageUp"].includes(event.key) && progress > 0.05) {
        event.preventDefault();
        goTo("intro");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goTo, progress]);

  return (
    <main className="entry-page">
      <section ref={stageRef} className="entry-stage" aria-label="Apresentação e acesso ao Prospecta">
        <div className="entry-sticky">
          <header className={`entry-header ${progress >= .55 ? "login-mode" : ""}`}>
            <a className="entry-brand" href="#inicio" onClick={(event) => { event.preventDefault(); goTo("intro"); }} aria-label="Prospecta — início">
              <span><Mail aria-hidden="true" /></span>
              <strong>Prospecta</strong>
            </a>
            <nav aria-label="Navegação da página">
              <button className={progress < .5 ? "active" : ""} onClick={() => goTo("intro")}>Conheça</button>
              <button className={progress >= .5 ? "active" : ""} onClick={() => goTo("login", true)}>Acessar</button>
            </nav>
            <button className="entry-access-shortcut" onClick={() => goTo("login", true)}>
              Entrar <ArrowRight aria-hidden="true" />
            </button>
          </header>

          <div className="entry-track" style={{ transform: `translate3d(${-progress * 100}vw, 0, 0)` }}>
            <section id="inicio" className="entry-scene entry-intro" aria-labelledby="entry-title">
              <div className="entry-copy">
                <div className="entry-kicker"><Sparkles aria-hidden="true" /> Prospecção sem ruído</div>
                <h1 id="entry-title">Cada contato no lugar.<br /><span>Cada oportunidade em movimento.</span></h1>
                <p>Importe empresas, organize contatos, envie e-mails e acompanhe cada próximo passo em um CRM criado para manter sua rotina comercial clara.</p>
                <div className="entry-actions">
                  <button className="entry-primary" onClick={() => goTo("login", true)}>
                    Acessar o Prospecta <ArrowRight aria-hidden="true" />
                  </button>
                  <span><ShieldCheck aria-hidden="true" /> Ambiente privado e protegido</span>
                </div>
                <div className="entry-capabilities" aria-label="Recursos principais">
                  <span><Building2 aria-hidden="true" /> Empresas</span>
                  <span><ContactRound aria-hidden="true" /> Contatos</span>
                  <span><Send aria-hidden="true" /> Envios</span>
                  <span><CalendarClock aria-hidden="true" /> Follow-ups</span>
                </div>
              </div>

              <div className="product-preview" aria-label="Prévia do painel Prospecta">
                <div className="preview-window">
                  <div className="preview-sidebar">
                    <span className="preview-logo"><Mail /></span>
                    <i className="selected" /><i /><i /><i /><i />
                  </div>
                  <div className="preview-main">
                    <div className="preview-top"><span>Visão geral</span><b>MB</b></div>
                    <div className="preview-greeting"><small>PAINEL COMERCIAL</small><strong>Bom dia, Marco</strong><span>Sua prospecção está em dia.</span></div>
                    <div className="preview-metrics">
                      <article><span>Empresas</span><strong>128</strong><small>+12 este mês</small></article>
                      <article><span>E-mails enviados</span><strong>346</strong><small>Últimos 30 dias</small></article>
                      <article><span>Taxa de resposta</span><strong>24%</strong><small>+3,2% no período</small></article>
                    </div>
                    <div className="preview-bottom">
                      <article><span>Atividade recente</span><div><i className="success" /><p><b>E-mail enviado</b><small>Aurora Tecnologia · agora</small></p></div><div><i /><p><b>Novo contato</b><small>Marina Costa · 12 min</small></p></div><div><i className="warning" /><p><b>Follow-up agendado</b><small>Studio Norte · amanhã</small></p></div></article>
                      <article><span>Próximos passos</span><b>6</b><div className="preview-chart"><i /><i /><i /><i /><i /></div></article>
                    </div>
                  </div>
                </div>
                <aside className="floating-event mail-event"><span><Check /></span><div><strong>E-mail enviado</strong><small>Entrega confirmada</small></div></aside>
                <aside className="floating-event follow-event"><span><CalendarClock /></span><div><strong>Follow-up</strong><small>Programado para amanhã</small></div></aside>
              </div>

              <button className="scroll-cue" onClick={() => goTo("login", true)} aria-label="Ir para o acesso">
                <span>Role para acessar</span><i><ArrowDown /></i>
              </button>
            </section>

            <section id="acesso" className="entry-scene entry-login" aria-labelledby="login-title">
              <button className="login-back" onClick={() => goTo("intro")}><ArrowLeft /> Voltar</button>
              <div className="login-context">
                <span className="context-mark"><Mail /></span>
                <p className="entry-kicker">Seu workspace</p>
                <h2>Continue de onde parou.</h2>
                <p>Empresas, conversas e próximos passos permanecem organizados para você retomar sua prospecção com tranquilidade.</p>
                <ul>
                  <li><Check /> Histórico centralizado</li>
                  <li><Check /> Envios e follow-ups acompanhados</li>
                  <li><Check /> Gmail conectado somente quando você autorizar</li>
                </ul>
              </div>

              <div className="login-panel">
                <div className="login-card">
                  <div className="login-card-heading">
                    <span className="login-icon"><ShieldCheck /></span>
                    <div>
                      <p>Acesso seguro</p>
                      <h2 id="login-title" ref={loginTitleRef} tabIndex={-1}>{user ? "Tudo pronto para continuar" : "Acesse seu workspace"}</h2>
                      <span>{user ? "Confirme sua conta para entrar no Prospecta." : "Entre com sua conta para continuar no Prospecta."}</span>
                    </div>
                  </div>

                  {user && (
                    <div className="login-account">
                      <span>{initials(user.displayName)}</span>
                      <div><strong>{user.displayName}</strong><small>{user.email}</small></div>
                      <Check aria-label="Conta autenticada" />
                    </div>
                  )}

                  <a className="login-submit" href={accessHref} target={user ? undefined : "_top"}>
                    {user ? "Entrar no Prospecta" : "Acessar o Prospecta"}<ArrowRight />
                  </a>
                  <div className="login-divider"><span>proteção da sua conta</span></div>
                  <div className="login-security"><ShieldCheck /><p><strong>Seus dados permanecem protegidos.</strong><span>A permissão para enviar e-mails pelo Gmail é solicitada separadamente dentro do CRM.</span></p></div>
                </div>
                <p className="login-footnote">Ao continuar, você acessa um ambiente privado do Prospecta.</p>
              </div>
            </section>
          </div>

          <div className="entry-progress" aria-hidden="true">
            <span><i style={{ width: `${Math.max(8, progress * 100)}%` }} /></span>
            <small>{progress < .5 ? "01  Apresentação" : "02  Acesso"}</small>
          </div>
        </div>
      </section>
    </main>
  );
}
