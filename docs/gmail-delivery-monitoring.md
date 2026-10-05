j# Monitoramento de devoluções do Gmail

## Envio e entrega são resultados diferentes

O runner continua enviando pela API Gmail com leases, barreira `PREPARED → SENDING`, quotas e recuperação conservadora. Uma resposta aceita continua resultando em `email_messages.status = SENT` e `email_campaign_recipients.status = SENT`. `COMPLETED` encerra o processamento dos envios, sem esperar a análise de devoluções.

O único acréscimo ao runner é um `Message-ID` RFC aleatório, validado contra CRLF, persistido junto da conta/endereço remetente antes do envio. O `providerMessageId` do Gmail continua sendo persistido nas mesmas transações. Estes dois identificadores são diferentes.

O serviço de leitura nunca envia mensagens, nunca altera os estados de execução, não chama o runner e não usa `UNCERTAIN` para bounces. Os contadores de envio continuam derivados dos estados existentes. Métricas de exclusão do público ficam em `audience_without_email` e `audience_invalid_email`, independentemente da posterior sincronização dos contadores de execução.

## Ativação e migração

1. Em bancos existentes, aplique `supabase/migrations/20261003000000_gmail_delivery.sql` **antes** de publicar a aplicação. Pré-requisitos: migrações anteriores de campanhas, chunks, reconexão e estados de mensagens. Há uma cópia equivalente em `drizzle/0001_gmail_delivery.sql`; aplique por um caminho só. O repositório usa SQL manual, sem journal Drizzle configurado.
2. Em banco novo, `supabase/schema.sql` inclui a estrutura anterior e esta migração.
3. Autorize `https://www.googleapis.com/auth/gmail.readonly` no projeto OAuth Google, mantendo `openid`, `email` e `gmail.send`.
4. Em **Configurações → Gmail**, escolha **Reconectar Gmail** e conceda a leitura explicitamente. A tela informa a nova permissão. Não é necessário trocar secrets.
5. Faça o deploy habitual do Worker. `vite.config.ts` registra o novo cron `*/2 * * * *`.

Contas antigas sem leitura retornam `needsReconnect: true` e `deliveryEnabled: false`. `connected` continua expressando a capacidade de enviar: uma autorização válida com `gmail.send` não é desativada apenas por faltar leitura. Nenhuma tentativa silenciosa amplia os scopes. O callback exige send + readonly e um novo refresh token válido.

`gmail.metadata` não basta: não permite a busca `q` nem a leitura do corpo estruturado DSN. `gmail.readonly` é o menor escopo aplicável a esta implementação. Ele concede leitura da caixa, embora o serviço consulte apenas candidatos delimitados. Não são solicitados `gmail.modify` nem acesso total. Referências: [scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [formato RAW](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format).

A migração é aditiva e tem defaults. Campanhas preexistentes recebem `delivery_monitoring_enabled = false`; novas recebem `true`. Destinatários existentes começam em `PENDING`, sem reclassificação em massa. Nada é apagado e nenhuma migração é aplicada automaticamente pelo aplicativo.

## Estados e classificação

| Resultado | Significado |
| --- | --- |
| `PENDING` | Aguardando uma consulta completa e aplicável; também preservado quando há análise incompleta |
| `NO_KNOWN_FAILURE` | Nenhuma falha correlacionada na consulta; não comprova entrega nem leitura |
| `BOUNCED` | Endereço (`ADDRESS_NOT_FOUND`) ou domínio (`DOMAIN_NOT_FOUND`) inexistente com alta confiança |
| `MAILBOX_FULL` | Caixa cheia; não invalida o endereço |
| `BLOCKED` | Recusa da mensagem, spam ou política; não invalida o endereço |
| `TEMPORARY_FAILURE` | Falha temporária, inclusive DSN `Action: delayed` |
| `UNKNOWN_FAILURE` | DSN correlacionado sem classificação segura |

Os campos `delivery_*`, `bounced_at` e `bounce_message_id` ficam no destinatário da campanha. `failureCategory` e `errorMessage` anteriores continuam exclusivos do envio. A tabela `email_delivery_events` vincula proprietário, campanha, destinatário, `email_message`, empresa e notificação Gmail, com categoria, código e diagnóstico limitado. Ela é a auditoria de entrega da mensagem, sem duplicar campos em `email_messages`.

O classificador prioriza 4.x como temporário, caixa cheia e recusa por política antes de inferir inexistência. `5.1.1` comprova destinatário inexistente; `5.1.2` só invalida domínio com diagnóstico explícito de inexistência/NXDOMAIN. DNS temporário, rejeição genérica e diagnósticos desconhecidos não invalidam. Estado permanente não é sobrescrito por um aviso temporário posterior.

## Correlação conservadora

1. Ler apenas MIME `multipart/report` com parte `message/delivery-status` ou `message/global-delivery-status`.
2. Extrair `Original-Message-ID`, `In-Reply-To`, `References` e headers de `message/rfc822`/`text/rfc822-headers`, além do destinatário estruturado. HTML e endereços soltos no corpo não participam.
3. Cruzar referência RFC e destinatário normalizado com mensagens locais `SENT`, proprietário e janela temporal. Para registros antigos, uma referência única pode ser resolvida via `in:sent rfc822msgid:` para encontrar o `providerMessageId` nessa caixa.
4. Sem referência, só associar quando existe **exatamente uma** mensagem enviada ao endereço na janela. A busca considera todas as campanhas e envios individuais do proprietário, antes de verificar a campanha atual. Duas possibilidades impedem a associação automática.
5. Exigir o vínculo local `recipient.messageId`, campanha, status e conta remetente. Uma referência presente que não confere nunca é descartada para tentar uma associação mais fraca.

O horário recebido é `internalDate` do Gmail, não o header Date controlado pelo remetente. Envios posteriores ao bounce ou fora do lookback não são candidatos. `threadId` fica apenas na auditoria: sozinho não identifica um envio.

## Cron, checkpoints e limites

O cron de entrega tem um evento próprio, separado do envio a cada minuto e da limpeza a cada cinco minutos. A função `processPendingDeliveryChecks()` usa o contexto PostgreSQL por invocação já existente.

- Uma campanha `COMPLETED` por execução; uma página com **um candidato Gmail**; até três destinatários estruturados no DSN.
- Até 24 horas após a conclusão (`DELIVERY_WINDOW_MS`), com lookback máximo de sete dias (`DELIVERY_LOOKBACK_MS`). Em campanhas mais longas, destinatários anteriores ao recorte permanecem sem análise.
- Após uma varredura, nova consulta em dez minutos. Se houver paginação, continuação no próximo cron. O ritmo é conservador: até 30 candidatos/hora compartilhados entre campanhas; caixas com muitos candidatos podem acumular atraso.
- Checkpoint por proprietário, conta e campanha em `gmail_delivery_sync_state`, com limites temporais fixos, `pageToken` e sobreposição de dez minutos entre varreduras. A troca de autorização reinicia o checkpoint.
- `messages.list` foi escolhido em vez da History API para evitar manutenção de histórico expirado e sincronização geral da caixa. A busca usa datas epoch, remetentes típicos e assuntos conhecidos. O assunto localiza candidatos; a classificação depende do DSN estruturado.
- A busca inclui spam/lixeira. Notificações não padronizadas, remetentes/assuntos fora da consulta, mensagens removidas, MIME truncado, anexos muito grandes ou devoluções posteriores à janela podem não ser reconhecidos.
- Tamanho máximo MIME 256 KiB, resposta JSON limitada durante streaming, headers 32 KiB, até 64 partes e profundidade oito. Nenhum anexo externo é baixado. O original anexado é lido apenas para headers, sem interpretar seu corpo.
- Budget lógico de 60 segundos; chamadas Gmail de leitura com timeout de até dez segundos e refresh OAuth com o timeout existente de 30 segundos. Sem retry de rede em loop; o cron seguinte retoma.
- Um lease de cinco minutos e fencing protegem o checkpoint. Eventos são únicos por `(owner_id, gmail_message_id, recipient)`; destinatário é normalizado. A mesma notificação pode descrever destinatários distintos sem duplicar um destinatário entre campanhas. Evento, atualização e activity log estão na mesma transação.
- Em interrupções, eventos já confirmados podem ser reencontrados com segurança. Uma leitura incompleta não transforma pendentes em “sem falha conhecida”. Campanhas completadas há mais de sete dias deixam a seleção automática, mesmo após indisponibilidade prolongada.

## Empresas e campanhas futuras

Somente `ADDRESS_NOT_FOUND`/`DOMAIN_NOT_FOUND` com confiança suficiente marcam `companies.primary_email_status = INVALID`. O UPDATE verifica, no banco e no mesmo instante, se o endereço principal normalizado ainda corresponde ao endereço devolvido. Uma correção concorrente fica protegida. O activity log `EMAIL_ADDRESS_INVALIDATED` só nasce quando a empresa efetivamente muda para inválida.

O endereço permanece cadastrado. A lista de empresas tem o filtro **E-mail inválido conhecido** e um indicador. No perfil, o usuário pode restaurar para `UNKNOWN` após revisão. A requisição compara o endereço exibido para impedir revisão de um endereço que mudou. Duplicatas do mesmo bounce não desfazem essa revisão.

Um trigger `reset_primary_email_delivery_status` restaura `UNKNOWN` quando o endereço normalizado muda, cobrindo formulário, importação e alterações diretas no banco. Apenas mudar maiúsculas/espaços não é um endereço novo.

Preview e preparação usam a mesma seleção determinística do contato primário. Um endereço principal `INVALID` é excluído quando for o destinatário efetivo; um contato primário diferente permanece elegível. Caixa cheia, bloqueios e temporários não são exclusões permanentes. As métricas `withoutEmail` e `invalidEmail` são separadas e persistidas na campanha.

## Relatório, exportação e privacidade

**Histórico de campanhas → Ver relatório** abre o monitor existente. A seção Resultado de entrega mostra totais, filtros por categoria, empresa/endereço, motivo curto, código e horário. A consulta HTTP é somente leitura e valida campanha + owner antes de consultar destinatários. A identidade local `local-preview-user` é preservada; este recurso não acrescenta autenticação multiusuário ao CRM. Ao introduzir autenticação real, substitua o resolvedor de owner no servidor, nunca por um parâmetro enviado pelo navegador.

O JSON usa páginas de 50 linhas; o CSV usa páginas de 1.000 com cursor crescente. A UI monta o CSV completo respeitando o filtro. Todos os campos são citados e aspas escapadas; prefixos `=`, `+`, `-`, `@` (também após whitespace) recebem apóstrofo. A exportação muito grande consome memória proporcional no navegador.

Refresh tokens continuam AES-GCM. Access tokens só existem na memória da invocação. Nenhum token é retornado ao frontend. Logs contêm apenas evento, campaignId e código controlado. Não são gravados corpo, MIME, anexos ou respostas OAuth/Gmail completas. Diagnóstico é texto com controles removidos, sem tags e limitado a 300 caracteres; React o renderiza como texto. Não se seguem links encontrados em mensagens.

## Troubleshooting

- **Reconexão necessária:** autorize leitura em Configurações → Gmail. `invalid_grant`/401 marcam a conta para reconexão, seguindo a semântica existente.
- **GMAIL_READ_FORBIDDEN:** confira consentimento, políticas Workspace e configuração da API. Um 403 não invalida empresas nem desativa automaticamente uma autorização de envio válida.
- **GMAIL_RATE_LIMIT / GMAIL_UNAVAILABLE:** 429/5xx preservam checkpoint e status dos destinatários; aguarde a próxima execução.
- **PARTIAL_ANALYSIS:** MIME excedeu limites, notificação não padronizada ou associação ambígua. Resultados já correlacionados aparecem, mas pendentes não são tratados como confirmados. Consulte o Gmail manualmente; não há reenvio automático.
- **Relatório sem atualização:** conferir execução do cron `*/2 * * * *`, migrations, conclusão da campanha, permissão readonly e quantidade de candidatos em espera. Campanhas antigas são explicitamente excluídas do backfill.
- **Campos/tabelas ausentes:** aplique a migração antes do código. Ela não foi executada em produção por esta implementação.

## Testes

```powershell
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm build
node --test scripts/test-gmail-delivery.mjs scripts/test-gmail-oauth.mjs scripts/test-individual-send.mjs scripts/test-campaign-runner.mjs scripts/test-worker-cron.mjs scripts/test-email-attachments.mjs scripts/test-storage-worker.mjs scripts/test-settings-timezone.mjs
node scripts/test-campaign-countdown.mjs
# Com corepack pnpm dev em outra sessão:
node scripts/test-campaign-ui.mjs
```

Os testes de entrega executam módulos reais com adaptador relacional em memória e Google simulado, incluindo transações, uniqueness, paginação, erros, ownership e concorrência. Os testes UI interceptam todas as APIs: não enviam Gmail nem alteram banco real. Não substituem uma validação operacional com uma conta de homologação e PostgreSQL migrado.
