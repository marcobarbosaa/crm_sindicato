# Envios Inteligentes

Implementação de 08/10/2026. Auditoria prévia: [smart-sends-audit.md](smart-sends-audit.md).

## Funcionalidades

Seção independente junto de Envio em lote: importação múltipla/drag-and-drop, progresso individual, análise textual local, revisão, mensagem personalizada, confirmação explícita, fila persistente, pausa/retomada/cancelamento e CSV. Um PDF corresponde a uma mensagem. Dois PDFs aprovados para a mesma empresa geram dois e-mails distintos; não há agrupamento automático.

O servidor valida extensão, MIME, assinatura, tamanho e SHA-256. O reconhecimento valida os dígitos verificadores do CNPJ; múltiplos CNPJs exigem revisão mesmo quando há palavras contextuais. Nomes são sugestões, nunca aprovações automáticas. PDFs sem texto podem ser associados manualmente; corrompidos, protegidos ou acima dos limites de leitura ficam bloqueados.

Todas as associações exigem confirmação por documento. O destinatário é o e-mail principal da empresa, validado novamente na preparação e imediatamente antes do envio. Contatos primários alimentam `{{contato}}`, sem mudar o destinatário. As demais variáveis são empresa, segmento, cidade, estado e email_empresa. A prévia congela assunto, corpo e assinatura no banco. Anexos comuns são opt-in e ficam vinculados pelos IDs persistidos no servidor; a limpeza existente respeita essa retenção mesmo após remoção do anexo do template.

## Importação — interface da etapa 2

Ao criar ou abrir um lote editável, a importação tem uma tela própria. Ela mostra nome do lote, etapa atual, navegação para os lotes, seleção múltipla/drag and drop e limites de documentos, bytes e páginas retornados pelo backend. Os resultados aparecem depois de **Continuar para identificação**; associação e configuração da mensagem ficam na **Revisão**. É possível voltar à importação e adicionar mais PDFs.

Os contadores acompanham a fila real e os documentos já existentes no lote. **100% transmitido** indica o término da transmissão; a linha continua em análise até a confirmação do servidor. Falhas de leitura, duplicatas e resultados incertos não contam como concluídos. A lista mostra 25 arquivos por página, com filtro de falhas e área de rolagem acessível por teclado; os totais incluem todas as páginas.

- **Pausar novos uploads** permite concluir a requisição atual e preserva os demais arquivos. **Continuar importação** retoma os aguardando.
- **Tentar novamente falhas recuperáveis** usa a recuperação da etapa 1, consultando os registros existentes antes de qualquer tentativa. Adicionar arquivos ou continuar a fila não reenvia automaticamente um resultado incerto.
- A remoção da fila fica disponível para arquivos ainda não enviados, com a fila parada. Não remove registros já persistidos.
- Após recarregar ou reabrir o lote, os arquivos pendentes precisam ser selecionados novamente; o navegador conserva apenas os metadados da fila. Um lote sem metadados locais ainda mostra seus documentos salvos.
- Para avançar com parte dos arquivos, a tela lista os que ficarão pendentes e exige ciência do usuário. O botão depende de pelo menos um documento persistido, permitindo consultar também lotes contendo apenas problemas de leitura. Essa ação não inicia e-mails nem altera as regras de revisão/envio.

Implementação em `components/smart-sends/{import-step,upload-dropzone,upload-progress,upload-file-list}.tsx`, com derivação dos estados em `import-state.ts`. Evidências e comandos desta etapa estão na auditoria.

## Identificação — interface da etapa 3

Importação, Identificação e Revisão são telas distintas, selecionadas por estado local. Consultar uma etapa não faz requisições, não reprocessa PDFs e não altera status, revisão ou confirmações do lote. Lotes encerrados permitem consultar a importação sem adicionar arquivos. Alterações locais no template invalidam apenas a disponibilidade da prévia na interface; o status persistido continua vindo do servidor.

A Identificação mostra os totais do lote e quatro grupos filtráveis: **Identificação única**, **Revisão necessária**, **Não identificado** e **Documento com problema**. Cada documento apresenta CNPJs extraídos, empresa/razão social, CNPJ e e-mail principal, método e motivo. Candidatas incluem o CNPJ na mesma consulta existente, restrita ao proprietário. Múltiplos CNPJs sempre pedem revisão, inclusive quando somente um está cadastrado. Sem CNPJ, nome de arquivo semelhante é apenas sugestão; texto ausente e corrupção têm motivos próprios.

O reconhecimento automático aparece separado da aprovação: **Aguardando confirmação**, **Confirmado**, **Requer correção** ou **Bloqueado**. Confirmado exige `READY` e `confirmedAt`. As categorias são derivadas exclusivamente para exibição, sem migração ou alteração do contrato de persistência. Na Revisão continuam disponíveis associação manual, confirmação individual e exclusão. Nenhuma categoria visual autoriza envio.

Identificação e Revisão renderizam 25 documentos por página; candidatas são expandidas sob demanda, em páginas de dez. Os contadores consideram todo o lote, contando cada empresa uma vez e preservando documentos distintos da mesma empresa. Os limites existentes do backend continuam restringindo o lote a no máximo 500 PDFs e as candidatas consultadas durante o upload; a fase não adiciona consultas por documento nem downloads de PDFs.

Implementação: `components/smart-sends/identification-{state.ts,step.tsx}` e `app/smart-sends-page.tsx`. Regressões: `node --test scripts/test-smart-identification.mjs`, suíte `scripts/test-smart-*.mjs` e navegador `node scripts/test-smart-ui.mjs` com APIs simuladas. As evidências visuais ficam em `outputs/smart-qa`. TypeScript exclui `outputs`, assim como o lint, para não compilar cópias de código geradas pelas auditorias.

## Revisão humana — interface da etapa 4

A revisão usa uma lista lateral de 25 documentos por página e um painel para o documento selecionado. A prévia carrega apenas o PDF solicitado, pela rota privada que já verifica proprietário e integridade; há alternativa para abrir em outra aba. No mobile, a lista e os detalhes têm telas alternáveis. “Próximo pendente” facilita percorrer o lote sem abrir modais.

Pesquisas de documento e empresa e filtros de pendentes, confirmados, bloqueados, excluídos, sem e-mail, e-mail inválido e duplicatas operam localmente sobre os dados recebidos, sem mutações. Os indicadores vêm de `reviewSummary`, derivado no servidor pela mesma política de apresentação do cliente. Pendentes, confirmados, bloqueados e excluídos são grupos distintos e somam o total; o resumo de envio existente permanece compatível.

O seletor consulta razão social, nome fantasia e CNPJ, com ou sem máscara, sempre restrito ao proprietário. Retorna no máximo 30 empresas por busca e renderiza dez por página. Mostra nome, fantasia, CNPJ, destinatário e impedimentos do e-mail. O ID interno é normalizado de número ou string decimal para inteiro positivo seguro; CNPJ nunca é usado como `companyId`.

Selecionar uma empresa salva a associação sem confirmá-la. O painel mostra **Documento → Empresa → Destinatário** antes do botão de confirmação. Corrigir uma associação confirmada remove a confirmação anterior e invalida a preparação do lote. Múltiplos CNPJs não impedem seleção manual válida; a ordem dos identificadores nunca escolhe uma empresa.

As mutações da nova interface enviam `expectedRevision` e, na confirmação, `expectedRecipient`. Sob o bloqueio transacional existente do lote, revisões desatualizadas e endereços diferentes do exibido são recusados. Esses campos são opcionais para compatibilidade com os clientes anteriores. A empresa é lida com bloqueio compartilhado, validação de proprietário e e-mail; arquivos bloqueados e documentos excluídos não podem ser confirmados. Não há alteração de schema nem dos estados persistidos.

A interface só apresenta sucesso após gravar e reler o lote. Em caso de erro ou resultado incerto, informa a causa, identifica a necessidade de sincronização e desabilita alterações e avanço até uma nova consulta bem-sucedida. A confirmação final exige ao menos um documento elegível. Nenhuma ação de revisão envia e-mails.

**Confirmação em lote não foi incluída.** A API atual confirma individualmente e não valida atomicamente o resumo inteiro de múltiplas associações. Um laço de confirmações poderia gerar aprovação parcial ou trabalhar sobre um resumo alterado. Mantém-se a revisão explícita por documento nesta etapa.

Componentes: `review-step.tsx`, `company-picker.tsx` e `review-state.ts` em `components/smart-sends`; política compartilhada em `lib/smart-review-policy.ts`. Cobertura adicional em `test-smart-review.mjs`, `test-smart-company-picker.mjs`, `test-smart-sends.mjs` e `test-smart-ui.mjs`, incluindo falha de rede, resposta atrasada, troca de associação confirmada, 100 documentos e isolamento entre proprietários.

## Implantação manual

Nenhuma etapa abaixo foi executada em produção.

1. Instalar dependências pelo lockfile: `corepack pnpm install --frozen-lockfile`.
2. Fazer backup e aplicar as migrações anteriores, depois **`supabase/migrations/20261008000000_smart_sends.sql`**, antes da nova aplicação. O arquivo cria `document_send_batches`, `document_send_items` e `document_send_delivery_events`, índices, RLS e relacionamentos. Também estende o CHECK de `email_messages.kind` com `SMART`, preservando os valores anteriores. Não altera registros de campanhas. As tabelas novas são exclusivamente acessadas pelo servidor, sem políticas anônimas de PostgREST.
3. Criar no Supabase Storage um bucket **privado**, por exemplo `crm-smart-documents`, permitindo somente `application/pdf`, com teto de 8 MiB. Não criar políticas públicas de leitura. Definir `SMART_SEND_BUCKET`. O código verifica que o bucket não é público antes de gravar/ler.
4. Configurar autenticação conforme a seção abaixo. Manter secrets Supabase/Gmail já existentes; nenhuma permissão OAuth adicional é introduzida.
5. Executar testes, TypeScript, lint e build. Publicar manualmente usando o procedimento Worker/Vinext do README somente após aprovação operacional.
6. Conferir os três Cron Triggers gerados em `dist/server/wrangler.json`, `keep_vars: true`, as variáveis no Worker e os logs de manutenção. Agendamento é parte do mesmo Worker; não depende de manter o navegador aberto. Consulte a [correção para Workers Free](cloudflare-cron-deploy.md).
7. Em homologação, conferir acesso, upload, revisão e recuperação usando empresas/documentos fictícios. O primeiro envio real exige autorização específica. Validar limites de CPU/memória e permissões da conta Cloudflare no plano efetivo antes de lotes grandes.

`supabase/schema.sql` é um consolidado legado e não substitui a nova migração. Há BOMs internos nesse consolidado; a suíte SQL remove esses caracteres somente ao lê-lo para montar o banco de teste. A nova migração não possui BOM.

## Autenticação e isolamento

O CRM existente usa `local-preview-user` em suas rotas; não há sessão de usuário nem isolamento multiusuário completo no aplicativo legado. Esta implementação não reescreve esse comportamento.

Em hospedagem, proteger **todo o CRM e todas as suas rotas** com Cloudflare Access, restringindo os operadores do mesmo workspace. Configurar:

| Variável | Configuração |
| --- | --- |
| `SMART_SEND_ACCESS_ISSUER` | `https://SEU-TIME.cloudflareaccess.com`, sem barra final |
| `SMART_SEND_ACCESS_AUD` | AUD da aplicação Access |
| `SMART_SEND_OWNER_MAP` | JSON como `{"operador@example.com":"local-preview-user"}` |
| `SMART_SEND_ALLOW_LOCAL` | `false` em hospedagem; `true` apenas para desenvolvimento via localhost |
| `SMART_SEND_BUCKET` | Nome do bucket privado exclusivo dos PDFs |

O módulo verifica assinatura RS256, issuer, audience, expiração e claims do JWT de Access. Não confia no header de e-mail isolado, em owner enviado pelo navegador ou no nome do arquivo para gerar caminhos. A identidade é mapeada no servidor. Sem configuração válida, falha fechado. Mutações exigem Origin da própria aplicação; PDFs são retornados por endpoint autenticado, com `no-store`, `nosniff` e CSP restritiva, sem URL pública ou token em query string.

O mapa permite resolução de proprietários nos serviços novos, mas **não torna as outras seções multiusuário**. Não provisionar workspaces de proprietários diferentes pela UI legada. Uma futura autenticação central do CRM é uma evolução separada.

Referência de implementação: [validação de JWT Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Limites e processamento

| Variável | Padrão | Teto aceito |
| --- | --- | --- |
| `SMART_SEND_FILE_BYTES` | 4 MiB | 8 MiB |
| `SMART_SEND_BATCH_FILES` | 100 | 500 |
| `SMART_SEND_MAX_PAGES` | 50 | 100 |
| `SMART_SEND_DRAFT_HOURS` | 24 horas | 168 horas |
| `SMART_SEND_RETENTION_DAYS` | 30 dias | 365 dias |
| `SMART_SEND_INTERVAL_SECONDS` | 60 segundos | 3600 segundos |

Valores não inteiros/positivos retornam ao padrão; valores acima do teto são limitados. O texto extraído tem teto de 200 mil caracteres. Os limites globais de anexos permanecem intactos: documento individual + anexos comuns precisam caber no conjunto de 10 arquivos/12 MiB.

Upload e análise são sequenciais no navegador e um PDF por requisição no Worker. Preparação usa consultas em conjunto e UPDATE de snapshots em lote, evitando uma chamada de banco por documento. O runner processa **uma mensagem por invocação**, com download limitado por arquivo, MIME em memória e timeout de 30s no Gmail. O parser [unpdf](https://github.com/unjs/unpdf) usa PDF.js adaptado para Workers. Nenhum conteúdo é encaminhado a serviços de OCR ou análise externos.

Crons de envio e manutenção alternada (Workers Free):

| Cron | Trabalho |
| --- | --- |
| `* * * * *` | Campanhas tradicionais, preservado |
| `1-59/2 * * * *` | Um envio inteligente a cada execução |
| `*/2 * * * *` | Alterna devoluções tradicionais, devoluções inteligentes, limpeza de anexos e limpeza de PDFs; uma tarefa por evento, cada tarefa a cada oito minutos |

A cadência efetiva padrão é até uma mensagem a cada dois minutos, respeitando o intervalo mínimo, a cota diária e a disponibilidade do lease. Campanhas podem adiar Envios Inteligentes ao ocupar a conta. A janela diária segue o timezone configurado no CRM. Os crons têm orçamentos separados de subrequests.

Campanhas, Envios Inteligentes, envio individual e rota legada `/api/email-batches` compartilham `campaign_owner_leases` e `dailyCampaignUsage`. `SENDING`, `QUEUED` e `UNCERTAIN` reservam cota; não só `SENT`. O runner de campanhas não foi reescrito. As rotas individual/legada receberam mutex e contagem compatível para eliminar corridas de cota; a rota legada também é limitada a 60s entre mensagens.

## Falhas e idempotência

Cada item tem UUID, SHA-256, Message-ID RFC persistente e ponteiro para a mensagem. A barreira `SENDING` é gravada atomicamente com a aquisição do item antes do fetch Gmail, sob lock do lote e validação do lease. Requisições concorrentes não enviam o mesmo item.

Rejeições transitórias explícitas do Gmail têm até três tentativas, separadas pelo intervalo. Falhas anteriores ao envio têm até três tentativas de infraestrutura. Erros OAuth que exigem intervenção pausam o lote. Corrupção/inconsistência ou mudança de destinatário bloqueiam o item.

Timeout, resposta ambígua ou falha ao persistir após a barreira deixam `UNCERTAIN`; nunca há reenvio automático. Após 10 minutos, um Worker novo reconcilia itens `PROCESSING` pela mensagem persistida, inclusive em lotes pausados/cancelados. `SENDING` continua incerto; `SENT` é preservado; preparação comprovadamente anterior ao fetch pode retornar à fila. A ação de revisão disponível encerra o item incerto **sem reenviar** e mantém a mensagem incerta no histórico. Conferir a pasta Enviados é responsabilidade do operador. Não existe botão de reenvio de incertos.

Pausa/cancelamento são serializados com a barreira. Um envio cuja barreira já foi adquirida pode terminar; cancelamento ignora os demais itens pendentes e não apaga o histórico.

## Retenção

- Rascunhos e prévias abandonados expiram após 24h sem edição. O lote é cancelado e os PDFs são limpos em pequenos blocos.
- PDFs removidos durante revisão têm margem de 10 minutos antes da limpeza para evitar corrida com upload ainda em trânsito.
- PDFs pendentes, em processamento ou incertos são conservados. Lotes pausados mantêm os documentos até retomada/cancelamento.
- Após término/cancelamento, arquivos elegíveis expiram em 30 dias. Nome, hash, associação e histórico permanecem no banco.
- Registro do arquivo é criado antes do PUT; falhas deixam uma chave rastreável para limpeza. Falha de exclusão mantém o registro para retentativa.
- Anexos comuns confirmados são retidos em READY/RUNNING/PAUSED. O cron tradicional ignora os retidos e continua limpando outros anexos.

## Monitoramento

`email_messages.kind = SMART` integra o histórico e `activity_logs` registra a timeline. Os controles operacionais ficam exclusivamente nas tabelas document_send_*.

O monitor usa o cliente Gmail de leitura e o parser DSN existentes, com lease/checkpoint próprios. Exige `gmail.readonly` já suportado pelo CRM; contas sem esse escopo podem enviar, mas exibem o erro de monitoramento. Correlaciona destinatário + **Message-ID RFC exato** + conta remetente. Não faz associação somente pelo endereço. Auditoria de devoluções é idempotente.

Aceitação permanece `SENT`; devolução posterior é resultado separado. Varredura completa sem devolução registra **Sem falha conhecida**, nunca “entregue”. Janela de monitoramento: primeiras 24h após envio, com descoberta limitada a sete dias. Sem evidência externa de entrega efetiva, essa classificação não é oferecida.

## Validação local

Resultado em 08/10/2026: **172 testes aprovados**, sem falhas, na suíte combinada abaixo. Também passaram cinco verificações de fluxo visual do módulo, 24 verificações visuais de campanhas e a suíte visual existente de e-mails/templates/anexos. TypeScript, lint e build local passaram. Evidências locais: `outputs/smart-all-tests.txt`, `outputs/smart-build-final.txt`, `outputs/smart-qa/report.json`, `outputs/campaign-qa/report.json` e `outputs/attachments-qa/report.json`.

Scripts novos: `test-smart-foundation.mjs`, `test-smart-sends.mjs`, `test-smart-security.mjs`, `test-smart-worker.mjs`, `test-smart-ui.mjs` e helper `smart-test-loader.mjs`.

- PDFs sintéticos reais: CNPJ único/formatado/múltiplo/ausente, nomes exatos/ambíguos, corrompidos, senha e ausência de texto.
- PostgreSQL embarcado PGlite: aplica schema/migrações, exercita serviços e runner reais com Gmail/Storage simulados; proprietário, duplicatas, upload, storage, confirmação, quota, OAuth, retries, timeout, cancelamento, reinício, concorrência e anexos exclusivos por destinatário.
- JWT: assinaturas geradas para testes, audience e mapeamento; CSRF e bypass local bloqueados.
- workerd real local: parser PDF sem rede externa e regressão de storage/OAuth.
- Navegador headless: APIs inteiramente interceptadas; fluxo completo e screenshots desktop/mobile em `outputs/smart-qa`.
- Regressões existentes: campanhas, Gmail OAuth, devoluções, anexos, envio individual, cron, countdown e timezone.

Comandos principais:

```powershell
node --test scripts/test-smart-foundation.mjs scripts/test-smart-security.mjs scripts/test-smart-sends.mjs scripts/test-smart-worker.mjs scripts/test-campaign-runner.mjs scripts/test-gmail-oauth.mjs scripts/test-gmail-delivery.mjs scripts/test-email-attachments.mjs scripts/test-individual-send.mjs scripts/test-worker-cron.mjs scripts/test-storage-worker.mjs scripts/test-campaign-countdown.mjs scripts/test-settings-timezone.mjs
corepack pnpm exec tsc --noEmit
corepack pnpm lint
corepack pnpm build
# Visual, em terminais separados; todas as APIs são interceptadas pelo teste:
node scripts/email-ui-harness.mjs
node scripts/test-smart-ui.mjs
```

Não houve teste em produção, migração remota, envio real ou deploy. PGlite não reproduz latência/pooler Supabase nem contenção TCP de múltiplos Workers. O build exibe avisos de chunks e classificação estática Vinext. Não houve teste de carga com 500 PDFs grandes ou streams comprimidos adversariais; arquivos extremos podem atingir CPU/memória do Worker antes do limite de texto/páginas.

## Evoluções possíveis

Autenticação central no CRM; agrupamento explícito de vários PDFs por mensagem; seleção de contato destinatário; OCR opcional com autorização, orçamento e política de privacidade; limites de trabalho mais rigorosos para PDFs adversariais; filas Cloudflare dedicadas com justiça entre campanhas; reconciliação assistida de incertos; monitoramento Gmail em lote por conta para bases maiores.

## Arquivos

Criados: `app/smart-sends-page.tsx`, `app/smart-sends.css`, `app/api/smart-sends/[[...path]]/route.ts`, `lib/pdf-company-matcher.ts`, `lib/pdf-text.ts`, `lib/smart-send-{auth,policy,storage,service,runner,delivery}.ts`, `lib/shared-send-control.ts`, migração SQL, testes smart e esta documentação/auditoria.

Modificados: `app/crm-app.tsx` e `app/globals.css` (apenas entrada/import de CSS isolado), `db/schema.ts`, `lib/attachment-service.ts` (retenção), `app/api/emails/route.ts` e `app/api/email-batches/route.ts` (controle compartilhado), `worker.ts`, `vite.config.ts`, `package.json`, `pnpm-lock.yaml`, `.env.example`, `.gitignore`, testes de envio individual/cron e referências no README/ARQUITETURA.
