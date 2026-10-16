# Auditoria — Envios Inteligentes

## Etapa 5 — auditoria final do redesign (16/10/2026)

### Resultado e comparação do fluxo

O módulo agora apresenta cinco fases explícitas, com navegação local independente dos estados persistidos. A etapa 5 conclui Confirmação e Acompanhamento sobre os serviços existentes. Nenhum código de campanhas, Gmail OAuth, crons, processadores, política de quota ou proteção contra reenvio foi alterado nesta etapa. Não houve envio real, deploy, alteração de banco remoto ou de configuração Cloudflare.

| Fase | Fluxo anterior ao redesign | Fluxo atual |
| --- | --- | --- |
| Importação | Upload, análise e revisão próximos na mesma tela | Fila própria, progresso por arquivo, pausa, recuperação e confirmação da persistência |
| Identificação | Resultado técnico misturado à associação | Quatro grupos, CNPJs, candidatas, motivos e reconhecimento separado da aprovação |
| Revisão | Tabela horizontal | Lista e detalhe com PDF sob demanda, filtros, seleção manual e confirmação individual |
| Confirmação | Configuração e prévia dentro da revisão | Tela própria com mensagem, assinatura, anexos, quota, destinatários e autorização explícita |
| Acompanhamento | Tabela de resultados e controles | Indicadores globais, pesquisa, filtros, horários registrados e controles compatíveis com o servidor |

Nas cinco fases, listas de documentos renderizam até 25 itens por página; os totais continuam considerando o lote inteiro. O teste de 100 documentos aprovados para uma empresa confirma 100 mensagens, uma por PDF, com acesso à última associação/prévia. A navegação não altera associações confirmadas nem reprocessa PDFs. A revisão em lote de associações não foi implementada; permanece a aprovação por documento.

### Segurança e rastreabilidade verificadas

- Proprietário, CNPJ, destinatário, integridade e confirmação individual continuam validados pelos serviços existentes. Reconhecimento ou seleção aproximada não autorizam envio.
- Preparação congela assunto/corpo/assinatura e anexos; mudar configuração local exige nova preparação. A autorização envia a revisão corrente, é registrada no servidor e não envia e-mails na própria requisição.
- Revisão desatualizada é recusada. Falha de comunicação não marca sucesso: a interface bloqueia ações dependentes até reconciliar. Resposta perdida depois de iniciar é reconciliada pelo GET, sem repetir a autorização.
- A lista final exclui documentos bloqueados/excluídos. Divergência entre elegíveis locais e resumo do servidor bloqueia a autorização. O processador preservado revalida destinatário e arquivo antes do envio.
- A consulta de quota usa `dailyCampaignUsage` e `sendingDayWindow`, incluindo mensagens reservadas e excluindo outros proprietários; não modifica quota nem reserva capacidade.
- Acompanhamento diferencia aceitação pelo Gmail, devolução e resultado incerto. Próxima execução só aparece com agendamento persistido válido. Pausa/cancelamento não desfazem mensagens cuja execução já começou.
- Retomada bloqueada por itens em processamento/incertos; encerramento manual de incerto conserva a evidência sem solicitar reenvio. CSV e acesso aos lotes históricos preservados.

### Arquivos desta entrega

| Arquivos | Mudança |
| --- | --- |
| `app/smart-sends-page.tsx` | Integração das cinco fases, configuração na Confirmação, reconciliação de operações e polling restrito ao Acompanhamento |
| `app/smart-sends.css` | Layout, densidade e responsividade das duas fases finais |
| `components/smart-sends/confirmation-step.tsx` | Nova tela de configuração, resumo, relação final e autorização |
| `components/smart-sends/monitor-step.tsx` | Novo painel de progresso, filtros e controles |
| `components/smart-sends/send-view-state.ts` | Tipos, elegibilidade, contadores, rótulos, filtros e datas |
| `lib/smart-send-queries.ts` | Campos adicionais de leitura: assinatura, quota por proprietário e horários persistidos |
| `scripts/test-smart-final-view.mjs` | Novos testes de elegibilidade, não agrupamento, filtros, contadores, incertos e horários |
| `scripts/test-smart-sends.mjs` | Integração de quota compartilhada e autorização somente de aprovados |
| `scripts/test-smart-import-contract.mjs` | Mock atualizado para a consulta adicional de quota |
| `scripts/test-smart-ui.mjs` | Fluxo das cinco fases, anexos, revisão desatualizada, resposta perdida, controles e 100 documentos |
| `docs/smart-sends.md`, `docs/smart-sends-audit.md` | Funcionamento, auditoria e publicação |

Os componentes das etapas anteriores foram reaproveitados. Não há migration nem mudança de `.env` nesta entrega.

### Validação executada

**312 testes aprovados:** 167 de Envios Inteligentes e 145 de regressão dos mecanismos tradicionais. Unitários, integração PGlite com serviços reais e Gmail/Storage simulados, contratos HTTP, autenticação e parser no workerd local. A suíte inicialmente revelou um mock de consulta desatualizado; corrigido, a execução final dos 167 passou integralmente.

Cobertura: um PDF; dezenas/100 PDFs; CNPJ único/múltiplo/ausente; nome de arquivo sugestivo; empresa inexistente; texto insuficiente/corrupção; associação manual e ID string; proprietário divergente; e-mail ausente/inválido; duplicatas/exclusões; troca de empresa confirmada; navegação sem mutações; falha de rede; recuperação de importação; confirmação desatualizada; pausa/cancelamento; aceitação, devolução e resultado Gmail incerto.

**74 verificações de navegador aprovadas:** 31 no fluxo inteligente, sete na gestão/histórico de lotes, 24 em campanhas tradicionais e 12 em e-mails/templates/anexos. Edge headless, desktop de 1440 px e mobile emulado de 390 px; APIs integralmente interceptadas. Capturas das novas fases inspecionadas visualmente, com atenção a legibilidade, estados, teclado/foco e ausência de overflow horizontal. São testes locais com mocks, não ensaios de dispositivos físicos ou entrega real.

TypeScript, lint e build concluídos sem erros. Build mantém os avisos existentes de chunks acima de 500 kB e classificação estática de rotas pelo Vinext. `git diff --check` sem erros de whitespace.

```powershell
# Unitários e integração do módulo
$smartTests = @(Get-ChildItem scripts/test-smart-*.mjs |
  Where-Object { $_.Name -notmatch 'ui' } | ForEach-Object { $_.FullName })
node --test --test-concurrency=1 $smartTests

# Regressões tradicionais e política de publicação
node --test scripts/test-campaign-runner.mjs scripts/test-campaign-countdown.mjs scripts/test-individual-send.mjs scripts/test-email-attachments.mjs scripts/test-gmail-delivery.mjs scripts/test-gmail-oauth.mjs scripts/test-settings-timezone.mjs scripts/test-worker-cron.mjs scripts/test-deploy-policy.mjs

node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ignore-pattern dist --ignore-pattern .next
node scripts/run-framework.mjs build

# Servidor estritamente local, em outro terminal, sem --remote:
node --import ./scripts/load-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .wrangler/state --ip 127.0.0.1 --port 5174 --inspector-port 0 --log-level error

# Navegador: todos os endpoints de aplicação são simulados pelos testes
$env:SMART_UI_TEST_URL = 'http://127.0.0.1:5174/workspace'
$env:CAMPAIGN_TEST_URL = 'http://127.0.0.1:5174'
$env:EMAIL_TEST_URL = 'http://127.0.0.1:5174'
node scripts/test-smart-ui.mjs
node scripts/test-smart-batch-ui.mjs
node scripts/test-campaign-ui.mjs
node scripts/test-email-ui.mjs
```

Evidências locais, ignoradas pelo Git: `outputs/smart-final-tests.txt`; relatórios JSON e capturas em `outputs/smart-qa`, `outputs/smart-batch-qa`, `outputs/campaign-qa` e `outputs/attachments-qa`. Os testes usam endereços `.test` e nunca iniciam envios reais.

### Limitações, riscos e recomendações

- A paginação limita o DOM, não a resposta de detalhe: o servidor continua devolvendo o lote completo, limitado pelas regras existentes (teto de 500 PDFs). Não houve ensaio de carga com 500 PDFs grandes. Avaliar payload, memória e latência antes de elevar limites.
- A quota é um retrato compartilhado, não uma reserva; outras operações podem consumir saldo. Horário de agendamento não garante execução pontual. Gmail, cron e rede reais não são exercitados pelos mocks.
- PGlite não reproduz a latência/contenção do Supabase remoto. CPU e limites reais do Worker exigem homologação separada. Não houve alteração de infraestrutura para contornar esses limites.
- Horários ausentes no banco aparecem como não informados. Não se infere entrega, início de processamento ou previsão de conclusão.
- PDF depende do visualizador do navegador, com link alternativo. Não foi adicionado OCR, agrupamento de PDFs, reenvio de incertos ou confirmação coletiva de associações.
- Template/assinatura exibidos como prévia são snapshots preparados; alterações posteriores exigem preparar novamente. Revisar a prévia individual antes de autorizar.
- Avisos de tamanho de chunks permanecem; otimização global do CRM fica fora deste escopo. Homologar também Safari/iOS e navegação assistiva antes de ampliar a operação.

### Publicação do redesign — somente após autorização

1. Revisar o diff e registrar a versão/commit. Instalar pelo lockfile (`corepack pnpm install --frozen-lockfile`) e repetir as verificações acima no ambiente de publicação.
2. Confirmar que a instalação já contém as migrações e o bucket privado das etapas anteriores, sem reaplicá-los. Esta etapa não requer migração, nova variável, mudança OAuth ou alteração de crons. Se o módulo ainda não existe no ambiente, tratar a instalação original da documentação como operação separada e autorizada.
3. Após autorização explícita de publicação, usar `corepack pnpm deploy`. O script existente refaz o build com `CLOUDFLARE_DEPLOY=1`, valida o artefato e publica o Worker `crm-sindicato` com `--keep-vars`. Não publicar diretamente um `dist` gerado para execução local, que pode conter configuração de desenvolvimento.
4. Conferir as cinco fases com PDFs sintéticos e destinatários de teste em homologação; validar Access, isolamento, PDF privado, quota e CSV. Importar/revisar/preparar não exige iniciar e-mails. Qualquer teste de envio real deve ser autorizado à parte.
5. Acompanhar erros e latência após publicação. Em regressão, reverter à versão anterior do Worker; estados persistidos permanecem compatíveis. Pausar o lote afetado quando necessário e nunca reenviar automaticamente itens incertos.

Nenhum comando de publicação deste procedimento foi executado nesta auditoria.

## Etapa 2 — redesign da importação (13/10/2026)

A importação agora ocupa uma tela própria, aberta ao criar ou selecionar um lote editável. Cabeçalho, nome do lote, etapa e volta aos lotes acompanham o design existente do Prospecta. A tabela de identificação e a configuração de mensagem só aparecem após a ação de continuar. O conteúdo e a lógica das fases seguintes foram mantidos; foi acrescentada a navegação de volta à importação.

Componentes extraídos para `components/smart-sends/`: `import-step.tsx`, `upload-dropzone.tsx`, `upload-progress.tsx`, `upload-file-list.tsx` e `import-state.ts`. Os limites exibidos vêm de `Detail.limits`, sem novos limites configuráveis fixados na interface. O guard de 500 metadados locais da etapa 1 permanece inalterado; não é apresentado como limite do lote.

Os indicadores derivam da fila e dos documentos do backend, evitando contar duas vezes o mesmo registro presente nas duas fontes. Resultado confirmado com falha de análise não aparece como sucesso. Cada linha distingue transmissão de bytes, espera pela análise, conclusão, rejeição, recuperação pendente e resultado incerto. Documentos de lotes reabertos também aparecem sem depender da existência de uma fila local. Falhas têm filtro, mensagem por arquivo e lista explícita de pendências antes de avançar com os documentos disponíveis.

A lista usa paginação de 25 linhas, área de rolagem com foco de teclado e linhas memoizadas com propriedades escalares e callback estável de remoção. Os totais incluem todas as páginas. Não há animações novas. Botões compartilhados, foco visível, controles nativos, progresso nomeado e anúncio resumido de contagens preservam navegação por teclado e legibilidade mobile.

### Recuperação preservada

`processImportQueue` recebeu apenas um callback opcional `shouldPause`, consultado antes de iniciar a próxima requisição, e uma proteção para não transmitir entradas incertas sem recuperação explícita. A pausa não aborta o XHR atual nem interrompe persistência/análise. Selecionar novos PDFs deixou de ativar implicitamente a recuperação de resultados incertos. A ação explícita continua usando snapshot, UUID/hash, resultado salvo e lease do backend já existentes.

A remoção local só é permitida com fila parada e arquivo sem resultado persistido, sem progresso de transmissão e em estado aguardando/rejeitado. A fila é salva antes de remover a linha da interface. A retomada após reload mantém a necessidade de reselecionar os bytes dos PDFs. Continuar para identificação exige um documento disponível e, havendo pendências, ciência da lista de arquivos que ficam de fora por enquanto. Não modifica exclusões no servidor nem dispara envio Gmail.

Não foram alterados contrato de API, serviços, Storage, banco, autenticação, cron, quotas ou lógica de envio. Não houve deploy nem uso de documentos reais.

### Validação e evidências

- **92 testes de unidade/integração aprovados**: regressões de contrato, importação, parser, banco, segurança e envio; novos casos de pausa entre requisições, retomada sem duplicação, bloqueio de reenvio implícito (inclusive PDF renomeado), contagens e elegibilidade/remoção.
- **21 verificações de navegador aprovadas**, em Edge headless com os componentes reais montados pelo harness Vite já existente e APIs inteiramente simuladas. Cenários com 1/2/3/4/10/26/30/50/100 arquivos, falha da atualização final, 503 no documento 26, reload/reseleção, PDF renomeado com resultado incerto, erros recuperáveis e definitivos, pausa/remoção/retomada, avanço parcial por teclado, drag and drop, limites dinâmicos e reabertura sem metadados locais.
- TypeScript e lint sem erros; build local concluído com `CLOUDFLARE_DEPLOY=1`, sem deploy. Permanecem avisos de chunks acima de 500 kB, tempos de plugins e classificação estática de rotas do Vinext.
- Capturas locais em `outputs/smart-qa/`: `desktop-import-empty.png`, `desktop-import-complete.png`, `mobile-import-complete.png`, `desktop-import-paused.png`, `desktop-import-errors.png`, `mobile-import-errors.png`, `desktop-import-100.png` e `mobile-import-100.png`. Relatório em `report.json`; artefatos ignorados pelo Git. Capturas desktop e mobile foram inspecionadas visualmente.

Comandos reproduzíveis:

```powershell
node --test scripts/test-smart-import-view.mjs scripts/test-smart-import-contract.mjs scripts/test-smart-import.mjs scripts/test-smart-foundation.mjs scripts/test-smart-sends.mjs scripts/test-smart-security.mjs scripts/test-smart-worker.mjs scripts/test-smart-company-picker.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --ignore-pattern dist --ignore-pattern .next
$env:CLOUDFLARE_DEPLOY='1'; node scripts/run-framework.mjs build
# Em terminais separados; todas as APIs são interceptadas:
node scripts/email-ui-harness.mjs
node scripts/test-smart-ui.mjs
```

Limitação da validação visual: o servidor de desenvolvimento com Worker não ficou acessível nesta sessão; o teste usou o harness local existente. Build, regressões dos serviços e teste do parser em workerd passaram separadamente. As capturas não validam latência ou serviços de produção.

## Correção da validação de IDs na importação

A divergência foi reproduzida **antes da alteração**: `importSnapshot("1")` recebendo o JSON `{ "batchId": 1, "items": [] }` falhava com `INVALID_RESPONSE` e a mensagem “Não foi possível verificar os documentos do lote.” O `z.literal(batchId)` preservava o tipo string recebido em runtime, apesar da assinatura TypeScript declarar `number`. O serviço de detalhe repassava `batch.id` sem normalização, enquanto o progresso usava `Number(batch.id)`. Isso confirma o defeito de contrato; não foi acessada uma resposta de produção para comprovar que o driver retornou string na ocorrência relatada.

`lib/smart-send-contract.ts` centraliza a normalização restrita a identificadores: aceita inteiros positivos seguros e strings compostas somente por dígitos decimais, rejeitando espaços, sinais, frações, expoentes, hexadecimal, booleanos, nulos e valores fora do intervalo seguro. A API normaliza IDs do histórico, criação, detalhe, empresas e templates; o frontend aplica a mesma regra às respostas. UUIDs dos documentos, hashes, booleanos, mensagens e demais dados não são convertidos. `getSmartBatch()` e `getSmartImportStatus()` retornam o ID do lote normalizado, inclusive quando a origem simulada fornece string.

`importSnapshot()` valida o ID solicitado antes da requisição, valida os campos da resposta e só então compara os IDs normalizados. Um ID de outro lote continua rejeitado. Os erros registram `smart-sends.contract-rejected` com nome fixo do contrato, caminhos de campos e códigos de validação; não registram corpo da resposta, valores, mensagens internas do Zod, PDF, tokens ou destinatários. A interface inclui o campo/contrato rejeitado na mensagem segura.

O novo `scripts/test-smart-import-contract.mjs` cobre a reprodução original, IDs número/string, lotes com 0/1/30/100 documentos, todos os campos de cada item, JSON malformado, IDs inválidos e divergentes, privacidade dos diagnósticos, normalização das fronteiras e recuperação sem reenviar documento salvo. Também executa os serviços reais com resultados de banco simulados contendo ID string, serializa seu JSON e o passa ao cliente. As regressões existentes de associação de empresa com ID string permanecem incluídas. Não houve alteração em Storage, autenticação, Gmail, campanhas tradicionais, cron, quotas, destinatários ou idempotência.

Arquivos desta correção: `lib/smart-send-contract.ts`, `lib/smart-import-client.ts`, `lib/smart-send-service.ts`, `app/api/smart-sends/[[...path]]/route.ts`, `scripts/test-smart-import-contract.mjs` e este relatório.

Validação desta correção: **85 testes aprovados**, TypeScript e lint sem erros, build concluído (avisos de tamanho de chunks e classificação de rotas do Vinext). Comando de regressão: `node --test scripts/test-smart-import-contract.mjs scripts/test-smart-import.mjs scripts/test-smart-foundation.mjs scripts/test-smart-sends.mjs scripts/test-smart-security.mjs scripts/test-smart-worker.mjs scripts/test-smart-company-picker.mjs`. Nenhum deploy realizado.

## Registro da auditoria original

Inspeção em 08/10/2026, antes da implementação.

- Runtime efetivo: Vinext sobre Cloudflare Workers; Drizzle/PostgreSQL (Supabase), não Prisma nem OpenNext. Partes históricas de ARQUITETURA.md estão desatualizadas.
- Identidade: rotas existentes usam `local-preview-user`, sem sessão autenticada. O módulo novo deve falhar fechado em hospedagem, verificar JWT do Cloudflare Access e mapear identidade para proprietário no servidor. Não transforma o CRM legado em aplicação multiusuário.
- Campanhas: lease persistente por proprietário e por campanha, blocos técnicos de cinco, janela diária por timezone, barreira PREPARED/SENDING, recuperação e UNCERTAIN. Compartilhar `campaign_owner_leases` e `dailyCampaignUsage` permite coexistência sem reescrever o runner.
- Envio individual: conta apenas SENT e não participa do lease. Necessita integração mínima ao controle compartilhado para eliminar corrida com as duas filas.
- Anexos: Supabase Storage privado, metadados registrados antes do upload e limpeza via cron; limites globais 8 MB/arquivo, 12 MB/conjunto. Documentos novos precisam de armazenamento e retenção próprios, preservando esses limites.
- Templates: texto simples, seis variáveis e anexos vinculados. Congelar assunto/corpo/assinatura e reter os IDs de objetos privados imutáveis dos anexos comuns evita mutações após revisão.
- Monitoramento: DSN, cliente Gmail limitado e política reutilizáveis; tabelas e correlação do monitor atual exigem campanha. Novo monitor deve usar estado próprio e Message-ID exato, sem campanhas artificiais.
- UI: navegação local em crm-app.tsx; classes e componentes existentes reutilizáveis. CSS adicional ficará restrito à nova seção.
- Testes: scripts node:test com TypeScript transpilado, adaptadores relacionais em memória e fetch simulado. Sem infraestrutura PostgreSQL de teste configurada no repositório.

Integrações: novas tabelas e APIs autenticadas, parser textual local compatível com Workers, revisão persistente por documento, uma mensagem por PDF, fila isolada, histórico `email_messages` e timeline, crons independentes para envio/manutenção/DSN. Nenhum upload inicia envio; confirmação final é a única transição para execução.

## Etapa 1 — estabilização da importação (13/10/2026)

### Fluxo e achados confirmados

Seleção → validação e SHA-256 no navegador → consulta resumida do lote → upload ao Worker → autenticação existente → validação de MIME/tamanho/assinatura → transação com lock do lote e do hash → registro no PostgreSQL → Supabase Storage privado → confirmação separada de `fileReady` → leitura pelo unpdf → identificação do CNPJ → atualização transacional do documento → resposta verificável → sincronização completa da interface ao final da fila.

- Antes, `await refresh(batchId)` ficava fora do tratamento de falhas de cada arquivo. Uma falha de GET, parsing ou serialização encerrava o laço e deixava os seguintes sem processamento.
- O XHR aceitava qualquer HTTP 2xx, inclusive HTML ou JSON incompleto, como sucesso. A API retornava apenas `{ok:true}`.
- Falhas após o Storage podiam deixar `fileReady=false`, mesmo com objeto salvo. A mensagem recomendava remover e reimportar, perdendo a distinção entre armazenamento e análise.
- `getSmartBatch()` consulta todos os itens, configurações, conta e sugestões. Repeti-lo após cada PDF transferia novamente campos como assunto/corpo e metadados de entrega, com crescimento acumulado aproximadamente quadrático no número de documentos.
- O schema converte timestamps bigint para `Date`; contagens SQL são explicitamente convertidas com `Number`. Não foi encontrada evidência de bigint JavaScript não serializável no fluxo examinado. Há teste de serialização de 100 itens; isso não reproduz todos os comportamentos do driver de produção.
- O Storage já tinha limites de 10 s para verificar bucket e 30 s para PUT/GET; o navegador, 120 s para upload. Timeout não prova que uma gravação deixou de ocorrer.
- O parser já limita bytes/páginas/texto e distingue senha, corrupção e ausência de texto. Não há OCR. Seus limites não garantem que todo PDF termine dentro do orçamento de CPU/memória do Worker.

### Hipóteses sem confirmação

Não foram consultados logs, banco ou documentos de produção. Portanto, não há diagnóstico definitivo para a interrupção por volta do 26º arquivo. Expiração do Access, HTML de login, 429/5xx, instabilidade do banco/Storage, particularidades de um PDF e limites de CPU/memória continuam possíveis.

Os [limites oficiais do Cloudflare Workers](https://developers.cloudflare.com/workers/platform/limits/) distinguem limites por requisição, CPU e memória do isolate (128 MB). Cada PDF usa uma requisição independente; não existe evidência de um limite cumulativo de 26 PDFs neste código. Confirmar plano, configuração e métricas reais antes de atribuir a causa à plataforma. A configuração local não fixa um orçamento `cpu_ms` específico.

### Implementação e contratos

- `lib/smart-import-protocol.ts`: resultado com `documentId`, `contentHash`, `persistence`, `storage`, `analysis`, `code`, mensagem segura e possibilidade de recuperação. Registro persistido não significa arquivo armazenado nem análise concluída.
- `lib/smart-import-client.ts`: valida Content-Type, JSON e contrato do upload; rejeita 2xx sem confirmação válida, ID/hash divergente e estados inconsistentes. HTTP 401/403, HTML inesperado e 429 interrompem com fila preservada. Erros 400/413 isolados continuam após reconciliação; corrupção de PDF é resultado próprio. Erros 408/500/502/503/504 ou desconexão provocam consulta do estado; incerteza não resolvida interrompe. Duas falhas seguidas de infraestrutura também pausam.
- `app/smart-sends-page.tsx`: separa progresso de transmissão, confirmação do servidor, análise e sincronização visual. Um GET final com erro não altera resultados confirmados. Sem redesign; acrescenta recuperação e instrução de reseleção.
- `GET /api/smart-sends/:id/import-status`: rota independente, autenticada, restrita ao proprietário, sem cache; consulta apenas campos necessários à reconciliação, inclusive tombstones de itens removidos. Não retorna PDF, chave de Storage, destinatários, corpo de e-mail ou sugestões.
- `POST /api/smart-sends/:id/upload`: mantém método e caminho existentes e acrescenta resposta estruturada (preserva `ok`). `x-upload-id` opcional permite idempotência usando a PK já existente; sua reutilização exige mesmo proprietário/lote/hash. Clientes antigos sem esse cabeçalho mantêm a detecção anterior de duplicatas. `x-recover-upload: true` permite uma tentativa explícita no mesmo registro.
- `lib/smart-send-service.ts`: idempotência verificada dentro dos locks existentes, antes do limite do lote. Salva `fileReady` assim que Storage é confirmado. Recuperação consulta primeiro o objeto existente e valida hash; apenas 404 permite novo PUT sem upsert no mesmo caminho. Um upload em andamento só pode ser retomado após cinco minutos, com `updatedAt` protegendo atualizações tardias da tentativa anterior. Falhas preservam registro/objeto e bloqueiam confirmação. A seleção por hash no cliente evita reimportar conteúdo já salvo no lote.
- `lib/smart-send-storage.ts`: mantém autenticação, bucket privado, redirects manuais, limites e escrita sem upsert; distingue objeto ausente (404) de indisponibilidade e substitui a orientação de remover/reimportar.
- `getSmartBatch()` mantém seu contrato e permanece disponível para revisão/exportação/envio; deixou de ser chamado após cada arquivo. Não houve migração nem alteração no banco, nas campanhas tradicionais, Gmail, cron, quotas, autenticação, regras de destinatário ou runner de envio.

### Recuperação operacional e limites

O navegador salva apenas metadados da fila em `localStorage` por lote, antes de enviar; não salva bytes de PDF, tokens ou chaves. Após reload, abrir o lote restaura a fila. “Recuperar pendentes” consulta os registros; para itens ainda não terminados, selecionar os PDFs originais novamente. O SHA-256 identifica os arquivos mesmo que o nome mude. Resultados existentes são reutilizados; uma recuperação usa o mesmo ID. Não há reenvio automático de e-mail.

Os objetos `File` se perdem ao recarregar a página; por isso a reseleção é necessária para retomar armazenamento/análise. Limpar o armazenamento local perde a lista de arquivos nunca transmitidos, mas uma nova seleção ainda consulta hashes persistidos antes de enviar. Se o armazenamento local estiver indisponível, a fila para antes de iniciar novas requisições. Solicitações antigas em andamento exigem aguardar o intervalo de cinco minutos. PDFs corrompidos/protegidos continuam exigindo revisão ou cópia corrigida; recuperação não faz OCR nem conserta PDFs.

A resposta resumida cresce linearmente com os registros do lote (inclui removidos para recuperação segura); não há paginação nesta etapa. Atualizações completas continuam podendo crescer com o conteúdo da revisão. Dados locais não substituem autorização: toda consulta e mutação valida o proprietário no servidor. Nenhum log novo inclui conteúdo de PDF, tokens ou chaves.

### Regressões e validação

Execução local concluída: **75 testes aprovados**, **12 cenários de navegador aprovados**, TypeScript e lint sem erros, build concluído. O build emite avisos de chunks acima de 500 kB e classificação estática de rotas do Vinext; nenhum deles impediu a geração. O relatório do navegador fica em `outputs/smart-qa/report.json` (artefato local ignorado pelo Git). Nenhum e-mail real, alteração em banco de produção ou deploy foi realizado.

Arquivos alterados nesta etapa: `app/smart-sends-page.tsx`, `app/api/smart-sends/[[...path]]/route.ts`, `lib/smart-import-client.ts`, `lib/smart-import-protocol.ts`, `lib/smart-send-service.ts`, `lib/smart-send-storage.ts`, `scripts/test-smart-import.mjs`, `scripts/test-smart-sends.mjs`, `scripts/test-smart-ui.mjs` e este relatório.

- `scripts/test-smart-import.mjs`: fila de 1/10/26/30/50/100 PDFs; falha do 26º; atualização visual com erro; protocolos HTTP/HTML/JSON; timeout/desconexão; expiração de sessão; pausa por falha global; recuperação após reload; hashes e duplicatas; validação do XHR real com transporte simulado.
- `scripts/test-smart-sends.mjs`: banco PGlite, parser real e Storage/Gmail simulados; contratos das rotas; idempotência; hash divergente; isolamento entre proprietários; timeout depois de gravar objeto; armazenamento ausente; lease ativo/expirado; integridade; remoção; corrupção; 100 PDFs sintéticos e tamanho relativo do JSON. Mantém regressões de envio existentes.
- `scripts/test-smart-ui.mjs`: navegador Edge headless, APIs inteiramente simuladas; lotes de 1/10/26/30/50/100 arquivos, falha da atualização final e 503 no 26º, reload e recuperação da fila sem duplicar registros.
- Comando de unidade/integração: `node --test scripts/test-smart-import.mjs scripts/test-smart-foundation.mjs scripts/test-smart-sends.mjs scripts/test-smart-security.mjs scripts/test-smart-worker.mjs scripts/test-smart-company-picker.mjs`.
- Verificações exigidas: `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/eslint/bin/eslint.js . --ignore-pattern dist --ignore-pattern .next`, `node scripts/run-framework.mjs build` (usar `CLOUDFLARE_DEPLOY=1` no build para não inserir DATABASE_URL na configuração gerada; não executa deploy).

### Validação posterior na Cloudflare

1. Publicar somente após revisão/autorização, preferencialmente em ambiente de homologação com proprietário e bucket de teste privados. Não usar o botão de iniciar envios.
2. Confirmar Access ativo e autenticar; importar inicialmente 1, 10 e 30 PDFs sintéticos únicos. Só depois ampliar a 50/100, sem concorrência agressiva.
3. No Network, verificar `application/json`, ID/hash e estados de cada POST; conferir que há uma consulta resumida inicial e nenhuma consulta completa após cada PDF.
4. Bloquear apenas o GET de detalhe ao final: todos os uploads confirmados devem permanecer registrados. Liberar e usar Atualizar.
5. Interromper a conexão durante um POST; recarregar, abrir o mesmo lote e recuperar/reselecionar PDFs. Comparar IDs antes/depois. Não deve haver um registro novo para tentativa incerta; se ainda ativo, aguardar cinco minutos.
6. Simular sessão expirada/HTML de Access e 503 em homologação; conferir pausa e preservação dos restantes. Reautenticar e recuperar. Testar corrupção, cópia idêntica e limite de arquivo.
7. Correlacionar horário/status e identificadores de requisição com observabilidade do Worker e Storage, sem registrar bytes, tokens, chaves nem dados pessoais. Verificar CPU, memória, erros 1102, tempo de banco e latência de Storage para investigar a ocorrência original. Testes locais não reproduzem cotas e condições reais do plano Cloudflare.
