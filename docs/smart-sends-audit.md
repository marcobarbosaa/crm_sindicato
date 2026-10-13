# Auditoria prévia — Envios Inteligentes

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
