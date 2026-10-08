# Prospecta CRM

CRM para organizar empresas, contatos, campanhas de e-mail e follow-ups.

## Envios Inteligentes

Importação de PDFs, identificação local por CNPJ, revisão obrigatória e fila independente de e-mails por documento. Antes de disponibilizar, aplicar a migração `20261008000000_smart_sends.sql`, criar bucket privado e configurar Cloudflare Access. Consulte [implantação, limites, autenticação e testes](docs/smart-sends.md) e a [auditoria prévia](docs/smart-sends-audit.md). O módulo não envia após upload; requer confirmação explícita.

## Requisitos

- Node.js 22.13 ou superior
- Corepack habilitado

## Desenvolvimento

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Abra `http://localhost:5173` no navegador.

## Verificações

```powershell
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm build
```

## Deploy na Cloudflare

Este projeto deve ser publicado como **Cloudflare Worker**, não como Cloudflare Pages e não usando OpenNext. No painel da Cloudflare, remova o preset OpenNext e use o repositório com o comando:

```text
corepack pnpm deploy
```

O comando gera o Worker Vinext e executa o deploy usando `dist/server/wrangler.json`. Configure `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `TOKEN_ENCRYPTION_KEY` como secrets/variáveis do Worker na Cloudflare; não coloque credenciais no comando de build.

O banco usa PostgreSQL no Supabase. As variáveis `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `TOKEN_ENCRYPTION_KEY` são necessárias apenas para conectar e enviar e-mails pelo Gmail.

## Supabase

1. Crie um projeto no Supabase.
2. Abra **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e execute.
3. Copie `.env.example` para `.env` e preencha os valores do projeto.
4. Mantenha `SUPABASE_SERVICE_ROLE_KEY` somente no servidor.

O runtime usa `DATABASE_URL` para conectar diretamente ao PostgreSQL do Supabase. O valor precisa ser a conexão PostgreSQL do projeto, não apenas `SUPABASE_URL` ou uma chave pública.

## Estrutura

- `app/`: páginas, componentes e rotas da aplicação
- `app/api/`: endpoints do CRM
- `components/ui/`: componentes visuais reutilizáveis
- `db/`: schema e acesso ao banco
- `supabase/schema.sql`: estrutura PostgreSQL para o SQL Editor

## Limpeza automática de anexos

O mesmo Worker executa a limpeza a cada 5 minutos via Cron Trigger nativo, configurado em `vite.config.ts`. O entrypoint `worker.ts` preserva o HTTP do Vinext e chama `cleanupAttachments()` diretamente no evento scheduled. O deploy registra o cron automaticamente.

Consulte [configuração, teste local e monitoramento](docs/email-attachments.md#cron-trigger-nativo-da-cloudflare). O endpoint POST protegido continua disponível para execução manual.

## Devoluções do Gmail após campanhas

O monitor de campanhas inclui **Resultado de entrega**, filtros e exportação CSV. Envios aceitos continuam `SENT`; uma devolução posterior tem resultado separado. “Sem falha conhecida” não comprova entrega.

Antes do deploy, aplique `supabase/migrations/20261003000000_gmail_delivery.sql` após as migrações anteriores. Reconecte o Gmail em Configurações para conceder `gmail.readonly`, mantendo `gmail.send`. Contas antigas continuam enviando, mas precisam de reconexão para leitura. O novo cron independente roda a cada dois minutos e analisa campanhas novas concluídas durante uma janela de 24 horas, com paginação e limites conservadores.

Endereços definitivamente inexistentes são marcados como inválidos e excluídos de campanhas futuras quando forem o destinatário efetivo. Nenhum endereço é apagado. Correções de endereço resetam o status; há revisão manual no perfil da empresa.

Veja [fluxo, migração, limites, segurança e testes](docs/gmail-delivery-monitoring.md). Testes específicos: `node --test scripts/test-gmail-delivery.mjs`.
