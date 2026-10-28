import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conecta Core — CRM de e-mails",
  description: "Organize empresas, contatos, envios e follow-ups em um só lugar.",
  icons: {
    icon: "/branding/favicon.svg",
    shortcut: "/branding/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
