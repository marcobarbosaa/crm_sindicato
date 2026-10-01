Correção de infraestrutura de campanhas — 30/09/2026

1. Causa raiz

O lote comercial era também a unidade de execução. O cron juntava até cinco campanhas (até 125 chamadas Gmail com o padrão de 25), mais renovação OAuth, downloads e limpeza de até 25 anexos na MESMA invocação. Promise.allSettled não cria orçamentos independentes. O catch de destinatário convertia exceções de runtime e até falhas de persistência posteriores à aceitação pelo Gmail em FAILED.

2. I/O anterior por destinatário

No caminho de sucesso com empresa vinculada: nove comandos SQL (dois controles, duplicidade, claim, INSERT de mensagem, vínculo ao recipient, dois updates de confirmação e activity log) e um fetch Gmail: dez operações de I/O. Havia ainda consultas e fetches de preparação, reconciliação e encerramento. Cada consulta de controle chamava getDb(), criando outro cliente PostgreSQL sem encerramento explícito.

Uma distinção importante: este projeto usa postgres-js por TCP, não D1 nem PostgREST. NÃO é correto contar cada SQL como um subrequest HTTP Cloudflare. As consultas aumentavam I/O e conexões; o fan-out do cron sozinho já podia exceder 50 fetches externos. Sem trace da invocação de produção não se pode afirmar qual operação exata consumiu o último subrequest.

3. Limite e configuração

vite.config.ts não declara plano nem limits.subrequests. O plano da conta não é inferível do repositório. A documentação consultada informa 50 subrequests externos no Free e 10.000 por padrão no Paid, além de limites de conexões. Nenhum limite foi elevado e nenhum upgrade é requisito desta alteração.

Fonte: https://developers.cloudflare.com/workers/platform/limits/#subrequests
Fonte: https://developers.cloudflare.com/workers/platform/limits/#simultaneous-open-connections

4. Unidade técnica

TECHNICAL_CHUNK_SIZE = 5. Cada invocação processa no máximo uma campanha, com no máximo cinco destinatários, uma renovação OAuth e até dez downloads (limite existente de anexos): até 16 fetches explícitos no caminho normal. Redirects automáticos são recusados nesses fetches, evitando multiplicação invisível por redirecionamento. Todas as consultas de processamento compartilham um cliente PostgreSQL com uma conexão dentro de AsyncLocalStorage, encerrado no finally; não há sockets globais entre invocações.

A janela de início de novos envios é de 60 segundos; fetch Gmail tem timeout de 30 segundos. Após erro de destinatário, o chunk termina. A recuperação trabalha em no máximo cinco recipients por invocação e não envia e-mails nessa mesma execução. Não há loop que consuma sucessivos chunks dentro da mesma invocação.

5. Regra comercial

batchSize permanece 25 e intervalMinutes permanece 10. logical_batch persiste UUID, IDs dos membros e horário inicial. last_batch_id registra que o recipient já teve um resultado naquele lote, inclusive rejeição transitória do Gmail. Os próximos chunks retomam os membros restantes. O intervalo de dez minutos só começa quando o lote lógico termina; não é aplicado entre chunks. O último lote pode ter menos de 25 membros. Limite diário e pause mantêm o lote incompleto para continuação.

Sem navegador, o cron de um minuto leva normalmente cinco execuções para um lote de 25 (aproximadamente quatro minutos entre o primeiro e o último chunk, mais os tempos de execução), antes de esperar dez minutos. Não é promessa de throughput de 25 mensagens a cada dez minutos de relógio. Com mais campanhas vencidas, a espera pode aumentar; a ordenação por updatedAt distribui as oportunidades de execução. Mantivemos Cron/PostgreSQL para uma solução proporcional, sem Queues/Workflows. Maior throughput seria motivo para avaliar uma fila, não para aumentar silenciosamente o chunk.

6. Classificação

PERMANENT_PROVIDER_FAILURE: rejeição confirmada e permanente do Gmail.
RETRYABLE_PROVIDER_FAILURE: HTTP 408, 429, 5xx ou indicação de rate limit/backend error/indisponibilidade temporária.
INFRASTRUCTURE_FAILURE: exceção anterior ao fetch, sem entrega externa iniciada.
UNCERTAIN_DELIVERY: fetch iniciado sem confirmação confiável, ou impossibilidade de persistir o resultado com segurança.

“Too many subrequests” é reconhecido sem depender do sufixo da mensagem. Os logs também registram infrastructureLimit quando a categoria de entrega é UNCERTAIN_DELIVERY. Mensagens públicas e logs não contêm tokens, credenciais, endereço do destinatário ou corpo do e-mail.

7. Retries

Rejeições transitórias confirmadas retornam a PENDING até MAX_ATTEMPTS = 3 e só participam novamente de outro lote lógico. A terceira rejeição vira FAILED. A mensagem da tentativa transitória fica RETRYABLE, sem aparentar falha definitiva no histórico. Falhas de infraestrutura anteriores ao envio não consomem uma tentativa de Gmail. Uma revisão manual que autoriza reenvio reinicia a contagem explicitamente.

8. Idempotência

Lease persistente por proprietário serializa campanhas disparadas por cron e HTTP. Claim condicional PENDING -> PROCESSING impede dois claims do mesmo recipient. Claim, INSERT PREPARED e vínculo da mensagem são atômicos. Antes de fetch, outra transação persiste SENDING e incrementa attempts; a barreira inclui o estado RUNNING e o lease da campanha. Sucesso atualiza mensagem, recipient e activity log atomicamente. Um erro de ACK após COMMIT não sobrescreve SENT. A deduplicação de mesmo destinatário/assunto enviado em 24 horas é preservada.

9. UNCERTAIN e recuperação

PREPARED prova que o fetch ainda não podia iniciar. PROCESSING sem mensagem ou com PREPARED pode voltar a PENDING. SENDING, UNCERTAIN e QUEUED legado sem resultado conhecido vão para UNCERTAIN, nunca para reenvio automático. SENT é recuperado como SENT. A recuperação também encontra campanhas pausadas/canceladas com PROCESSING antigo; não depende de polling do navegador. UNCERTAIN pausa a campanha e preserva o fluxo de revisão. A revisão atualiza recipient e mensagem na mesma transação, para manter histórico, deduplicação e cota consistentes.

Se não houver mais I/O disponível para salvar o adiamento, o lease expira em cinco minutos e PROCESSING é reconciliado após dez minutos. Uma interrupção no estreito intervalo entre a gravação SENDING e o fetch pode exigir revisão mesmo sem ter enviado: é uma escolha conservadora para impedir duplicidade.

10. Queries e recursos

Uma consulta getCampaignControlState por recipient substitui os dois controles separados. A verificação final de pause/cancel foi incorporada ao UPDATE da barreira de envio. A reconciliação faz JOIN com mensagens, evitando SELECT por recipient; os contadores são sincronizados no encerramento. Compartilhar a conexão elimina a criação de clientes por helper. Transações acrescentam BEGIN/COMMIT; a correção não afirma que cada query virou menos I/O. Atomicidade foi priorizada.

11. worker.ts

Cron '* * * * *': encontra uma campanha e executa um chunk. Cron '*/5 * * * *': somente limpeza de anexos, em invocação independente. O endpoint autenticado /runner também limita a uma campanha. O handler HTTP Vinext foi preservado. READY só envia após start explícito. O processamento não depende do navegador; a assistência por polling existente continua disponível.

12. campaign-runner.ts

Persistência de lote, recuperação limitada, classificação por estágio, lease por proprietário, transações de preparação/confirmação, parada em falhas, timeout e logs estruturados campaignId/recipientId/batchId/chunkId/attempt/stage/category. A cota considera SENT e reservas SENDING/UNCERTAIN/QUEUED dentro da janela diária; consultas de monitoramento usam o mesmo predicado. O lease protege concorrência ENTRE campanhas; os endpoints legados de envio individual e /email-batches não foram reimplementados e continuam com suas regras próprias de concorrência.

13. Schema e API

Migração aditiva: supabase/migrations/20260930000000_campaign_chunks.sql.
Novos campos: email_campaigns.logical_batch e processing_notice; email_campaign_recipients.last_batch_id e failure_category. Nova tabela campaign_owner_leases, com RLS, e índice de recuperação. Status são text no schema existente; PREPARED/SENDING/RETRYABLE/UNCERTAIN não exigem alteração de enum SQL.

Aplicar a migração ANTES do deploy do código. O código antigo deve parar de processar campanhas antes da troca para não enviar sem os novos leases. Não executar versões antigas e novas simultaneamente. Não aplicar rollback de código que volte a reenviar estados ambíguos. A migração não reenvia nem altera destinatários historicamente FAILED: erros antigos de subrequests precisam de revisão do resultado real no Gmail antes de qualquer recuperação manual.

14. Monitoramento

/monitor inclui recipients PENDING com motivo de adiamento e failureCategory. CampaignMonitor mostra “Processamento adiado”, aviso de infraestrutura e “Continuação do lote atual”; o countdown distingue continuação de novo lote. Histórico geral reconhece os novos estados de mensagem. Resume preserva lease ativo e intervalo futuro; a revisão é bloqueada enquanto houver processamento ativo.

15. Testes

53 testes aprovados pelo runner Node: 40 cenários de processamento/rotas, seis do Worker, cinco MIME/anexos e dois arquivos de fronteiras (nove verificações de countdown e cinco de fuso). Os testes executam os módulos reais com adaptador relacional em memória, transações e falhas simuladas, sem enviar mensagens reais.

Cobertura obrigatória: 25 destinatários; interrupção no meio; subrequests; Gmail 429 e 500; erro permanente; exceção antes do fetch e durante fetch; SENT prévio; duplicidade; pause/cancel; daily limit; stale PROCESSING; UNCERTAIN; MAX_ATTEMPTS; último lote menor. Também: perda de ACK após commit e após agendamento, intervalo preservado após revisão no fim do lote, indisponibilidade total do banco, preservação de lote/lease/intervalo no resume, revisão manual e cota reservada por envios incertos.

Testes de navegador: 22 cenários de campanhas aprovados, mais suítes existentes de configurações e e-mail/anexos. APIs interceptadas no harness isolado. Capturas e relatórios em outputs/campaign-qa, outputs/settings-qa e outputs/attachments-qa.

Não foi executada migração contra banco real, nem teste de carga em uma conta Cloudflare/Gmail real. O limite de fetches é derivado da arquitetura; validação de CPU/memória com anexos máximos e o plano efetivo continuam sendo verificações do ambiente de implantação.

16. Lint

npm run lint: aprovado após corrigir os dois problemas encontrados nos novos testes.

17. Typecheck

node node_modules/typescript/bin/tsc --noEmit: aprovado.

18. Build

npm run build: aprovado. Vinext/Vite emitem avisos de tamanho de chunk, tempos de plugins e classificação estática de rotas; nenhum erro de build. Nenhum deploy foi executado.

Comandos reproduzíveis:

node --test scripts/test-campaign-runner.mjs scripts/test-worker-cron.mjs scripts/test-email-attachments.mjs scripts/test-settings-timezone.mjs scripts/test-campaign-countdown.mjs
npm run lint
node node_modules/typescript/bin/tsc --noEmit
npm run build

Para as suítes de navegador, iniciar node scripts/email-ui-harness.mjs (porta 5174), configurar CAMPAIGN_TEST_URL e SETTINGS_TEST_URL como http://localhost:5174 e executar scripts/test-campaign-ui.mjs, scripts/test-settings-ui.mjs e scripts/test-email-ui.mjs. Elas usam Edge headless e interceptam as APIs.

Diagnóstico adicional — 01/10/2026

O log genérico setup-or-finalize da campanha 8 foi investigado no ambiente local. O lote persistido correspondia ao UUID informado. A preparação real carregou o PDF e descriptografou o token; a renovação OAuth retornou HTTP 400 / invalid_grant, com indicação de token expirado ou revogado. Nenhum endpoint de envio foi chamado no diagnóstico e nenhum destinatário foi alterado.

Correção: GmailOAuthError conserva apenas códigos permitidos e status HTTP, com mensagens locais seguras. Não propaga error_description arbitrário do Google. O runner registra a etapa real (attachments, oauth-decrypt, oauth-refresh, finalize etc.). invalid_grant pausa a campanha, informa GMAIL_REAUTH_REQUIRED e pede reconexão; falhas temporárias OAuth continuam elegíveis para retry. A API devolve requiresReconnect e notice, e o monitor já mostra processingNotice persistido. O lote e as tentativas dos destinatários são preservados.

A resolução da autorização depende de ação do titular: Configurações → Gmail → Reconectar Gmail; concluir o consentimento Google e depois retomar a campanha pausada. Não é possível tornar válido um refresh token revogado apenas repetindo a renovação. O status “Conectada” no painel existente indica cadastro/permissões salvos, não uma validação online do token.

Foram acrescentados 12 testes de OAuth/runner, totalizando 65 testes sem navegador aprovados, incluindo resposta sem JSON, erro desconhecido com texto sensível, configuração ausente, OAuth 503 e continuação do mesmo lote após reconexão. Comando: node --test scripts/test-gmail-oauth.mjs scripts/test-campaign-runner.mjs scripts/test-worker-cron.mjs scripts/test-email-attachments.mjs scripts/test-settings-timezone.mjs scripts/test-campaign-countdown.mjs.

Referência: https://developers.google.com/identity/protocols/oauth2/web-server#offline
