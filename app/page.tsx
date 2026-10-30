import type { Metadata } from "next";
import { EntryExperience } from "./entry-experience";

// Keep the landing page identity independent from the workspace.
export const metadata: Metadata = {
  title: "Conecta Core — Gestão e relacionamento empresarial",
  description: "A Conecta Core reúne empresas, contatos, campanhas e acompanhamentos em uma experiência organizada, fluida e integrada de gestão e relacionamento empresarial.",
  icons: {
    icon: "/branding/favicon.svg",
    shortcut: "/branding/favicon.svg",
  },
};

export default function Home() {
  return <EntryExperience accessHref="/workspace" />;
}
