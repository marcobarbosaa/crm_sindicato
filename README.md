# Prospecta CRM

CRM para organizar empresas, contatos, campanhas de e-mail e follow-ups.

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
