import type { Metadata } from "next";
import { EntryExperience } from "./entry-experience";

// Keep the landing page identity independent from the workspace.
export const metadata: Metadata = {
  title: "Prospecta — CRM de e-mails",
  description: "Organize empresas, contatos, envios e follow-ups em um só lugar.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function Home() {
  return (
    <EntryExperience
      user={{ displayName: "Administrador", email: "admin@prospecta.local" }}
      accessHref="/workspace"
    />
  );
}
