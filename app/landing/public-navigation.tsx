"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, ArrowUp, Menu } from "lucide-react";
import { Brand } from "./brand";
import styles from "./landing.module.css";

const links = [["#visao-geral", "A plataforma"], ["#como-funciona", "Como funciona"], ["#recursos", "Recursos"]];

export function PublicHeader() {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <header className={styles.header}>
    <div className={styles.headerInner}>
      <a href="#inicio" aria-label="Conecta Core — início"><Brand /></a>
      <nav className={styles.desktopNav} aria-label="Navegação principal">{links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav>
      <a className={styles.headerAccess} href="/workspace">Acessar CRM <ArrowRight aria-hidden="true" /></a>
      <details className={styles.mobileMenu} ref={menu} onKeyDown={event => {
        if (event.key === "Escape" && menu.current?.open) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}>
        <summary aria-label="Menu de navegação"><Menu aria-hidden="true" /></summary>
        <nav aria-label="Navegação mobile" onClick={() => { if (menu.current) menu.current.open = false; }}>
          {links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
          <a href="/workspace">Acessar Conecta Core</a>
          <a href="#inicio">Voltar ao início</a>
        </nav>
      </details>
    </div>
  </header>;
}

export function PublicFooter() {
  return <footer className={styles.footer}><div className={styles.container}>
    <a href="#inicio" aria-label="Conecta Core — início"><Brand /></a>
    <p>Gestão conectada. Relacionamentos que evoluem.</p>
    <a href="#inicio">Voltar ao início <ArrowUp aria-hidden="true" /></a>
  </div></footer>;
}
