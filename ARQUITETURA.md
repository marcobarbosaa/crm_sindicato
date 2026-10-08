# Arquitetura do CRM Prospecta

## Envios Inteligentes (08/10/2026)

Módulo aditivo com tabelas document_send_*, parser PDF local, APIs verificadas por JWT Cloudflare Access, revisão persistente e runner independente. Compartilha leases/cota diária com campanhas e envio individual; reutiliza Gmail MIME/OAuth e parser DSN. Crons independentes preservam os orçamentos das campanhas. Consulte [arquitetura operacional e implantação](docs/smart-sends.md).

Correção à descrição histórica de identidade: as rotas legadas usam `local-preview-user`; não existe autenticação central implementada. O módulo novo exige Access em hospedagem e mapa explícito de operador/proprietário. A aplicação legada continua sendo um workspace único.

## Monitoramento de devoluções Gmail

O runtime atual é Vinext/Cloudflare Worker com Drizzle e PostgreSQL no Supabase (`db/index.ts`). O envio em lote mantém seus leases por proprietário/campanha, barreira de envio, retries e sincronização de contadores. Após `COMPLETED`, `lib/gmail-delivery.ts` reconcilia devoluções em um cron independente, sem chamar o runner nem mudar `SENT`/`UNCERTAIN`.

`lib/delivery-parser.ts` interpreta DSN MIME limitado; `lib/delivery-policy.ts` concentra classificação e sanitização puras; `lib/gmail-delivery-client.ts` contém somente chamadas de leitura ao Google com timeout, streaming limitado e redirects desabilitados. A autorização acrescenta `gmail.readonly` sem substituir `gmail.send`; criptografia AES-GCM continua em `lib/gmail.ts`.

`email_delivery_events` é a auditoria idempotente vinculada à mensagem enviada, destinatário e campanha. `gmail_delivery_sync_state` armazena paginação e lease por conta/campanha. O resultado de entrega no destinatário é separado do estado de envio. A alteração mínima no runner gera/persiste o Message-ID RFC e a conta remetente para correlação segura.

`GET /api/email-campaigns/:id/delivery` verifica campanha/proprietário e retorna relatório paginado ou CSV seguro. O componente `CampaignDelivery` integra o monitor existente. `PATCH /api/companies/:id/email-status` permite revisão manual com comparação do endereço atual. Um trigger PostgreSQL reseta o status quando o endereço muda, inclusive por importação. Preview/prepare compartilham a seleção do destinatário e separam ausentes de inválidos conhecidos.

Consulte [decisões, limites operacionais e testes](docs/gmail-delivery-monitoring.md). As seções abaixo preservam o histórico do primeiro recorte; a descrição de infraestrutura nesta seção representa o runtime atual.

## 1. Objetivo do primeiro recorte

Entregar uma base executável antes dos módulos complexos. A versão atual implementa dashboard, cadastro, busca, edição e exclusão de empresas, múltiplos contatos, timeline automática e persistência relacional.

## 2. Camadas

- `app/crm-app.tsx`: navegação, dashboard e listagem de empresas.
- `app/company-detail.tsx`: perfil editável, contatos e timeline da empresa.
- `app/import-page.tsx`: leitura local da planilha, associação de colunas, revisão e confirmação.
- `app/templates-page.tsx`: biblioteca, editor, variáveis e pré-visualização dos templates.
- `app/emails-page.tsx`: conexão do Gmail, composição, envio individual e histórico.
- `lib/gmail.ts`: criptografia de tokens, renovação OAuth e criação da mensagem MIME.
- `app/api`: controladores HTTP. Validam entrada e coordenam operações.
- `db/schema.ts`: modelo relacional e índices.
- `db/index.ts`: acesso centralizado ao banco.
- Futuramente, regras extensas serão extraídas para `services`, evitando lógica de negócio nos componentes.

## 3. Entidades iniciais

- `companies`: dados e estágio de cada empresa.
- `contacts`: múltiplos contatos por empresa, já suportados pelo modelo.
- `email_templates`: assunto e corpo reutilizáveis.
- `email_messages`: cada envio é um registro próprio; não existe apenas um booleano “enviado”.
- `activity_logs`: trilha de auditoria e timeline.
- `follow_ups`: compromissos futuros independentes da empresa.

As próximas migrações acrescentarão contas de e-mail, tags e configurações operacionais.

`import_batches` registra cada importação e seus totais. O arquivo original é lido no navegador e não é armazenado; somente os dados confirmados e o resumo da operação chegam ao banco.

## 4. Fluxo implementado

1. Usuário abre o dashboard.
2. Frontend consulta métricas e empresas pelas rotas `/api/dashboard` e `/api/companies`.
3. O backend identifica o usuário no servidor e filtra todos os registros por proprietário.
4. Ao cadastrar uma empresa, o backend grava empresa, contato principal opcional e atividade.
5. Ao abrir uma empresa, o perfil reúne dados comerciais, contatos e atividades.
6. Edições, mudanças de status e alterações de contatos geram atividades automaticamente.
7. O dashboard é recalculado a partir dos registros reais.

## 5. Rotas atuais

| Método | Rota | Responsabilidade |
|---|---|---|
| GET | `/api/dashboard` | Métricas e atividade recente |
| GET | `/api/companies?search=` | Listagem e busca |
| POST | `/api/companies` | Cadastro com contato principal opcional |
| DELETE | `/api/companies?id=` | Exclusão protegida por proprietário |
| GET | `/api/companies/:id` | Perfil, contatos e timeline da empresa |
| PATCH | `/api/companies/:id` | Edição dos dados e estágio da prospecção |
| POST/PATCH/DELETE | `/api/companies/:id/contacts` | Gestão dos contatos vinculados |
| GET | `/api/imports` | Histórico das últimas importações |
| POST | `/api/imports` | Pré-validação ou importação confirmada de até 1.000 linhas |
| GET/POST/PATCH/DELETE | `/api/templates` | Biblioteca e manutenção dos templates de e-mail |
| GET/DELETE | `/api/gmail/status` | Estado e desconexão da conta Gmail |
| GET | `/api/gmail/connect` | Início da autorização OAuth do Google |
| GET | `/api/gmail/callback` | Conclusão segura da autorização OAuth |
| GET/POST | `/api/emails` | Histórico e envio individual pelo Gmail |

## 6. Plano por etapas

1. **Fundação** — concluída: identidade, dashboard, empresas, banco e auditoria básica.
2. **CRM essencial** — concluída: edição, perfil da empresa, contatos múltiplos e timeline. Tags permanecem para uma etapa posterior.
3. **Importação** — concluída: CSV/XLSX, mapeamento, validação, duplicatas e histórico.
4. **Mensagens** — concluída: templates, variáveis, integração OAuth com Gmail e envio individual.
5. **Fila** — lote individualizado, velocidade, retries e prevenção de duplicatas.
6. **Operação** — histórico, follow-ups, configurações e limites.
7. **Evolução** — respostas, campanhas, equipes, webhooks e automações.

## 7. Decisão sobre o banco

Na versão hospedada, o banco SQL é o serviço relacional nativo do ambiente. Se o CRM for levado a uma infraestrutura própria, a mesma separação permite trocar a camada de persistência por PostgreSQL + Prisma sem reescrever a interface ou os fluxos.
