"use client";

import { useRef } from "react";
import { ArrowRight, ArrowUp, Menu } from "lucide-react";
import { Brand } from "./brand";
import styles from "./landing.module.css";

const links = [["#apresentacao", "A plataforma"], ["#empresas", "Relacionamentos"], ["#recursos", "Recursos"]];

export function PublicHeader() {
  const menu = useRef<HTMLDetailsElement>(null);
  return <header className={styles.header}>
    <div className={styles.headerInner}>
      <a href="#inicio" aria-label="Conecta Core — início"><Brand /></a>
      <nav className={styles.desktopNav} aria-label="Navegação principal">{links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</nav>
      <a className={styles.headerAccess} href="#acesso">Acessar plataforma <ArrowRight aria-hidden="true" /></a>
      <details className={styles.mobileMenu} ref={menu} onKeyDown={event => {
        if (event.key === "Escape" && menu.current?.open) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}>
        <summary aria-label="Menu de navegação"><Menu aria-hidden="true" /></summary>
        <nav aria-label="Navegação mobile" onClick={() => { if (menu.current) menu.current.open = false; }}>
          {links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
          <a href="#acesso">Acessar plataforma</a>
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
