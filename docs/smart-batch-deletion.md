# Gerenciamento e exclusão de lotes

## Auditoria anterior à implementação

- A revisão, o início e a reserva de upload bloqueiam `document_send_batches`. O upload grava no Storage fora da transação e usa `updated_at` como barreira de recuperação.
- `confirmed_at` do lote marca autorização de início; o mesmo campo no documento marca apenas revisão. Lotes READY podem nunca ter iniciado.
- `document_send_items.message_id`, `rfc_message_id`, tentativas e timestamps preservam evidências adicionais. Mensagens também conservam IDs de anexos. Eventos de devolução referenciam documentos; logs de atividade não possuem FK de lote.
- `duplicate_of` possui FK sem CASCADE na migração, embora o schema Drizzle não declare essa referência. Apagar somente o lote falharia nas FKs de documentos e duplicatas.
- A limpeza existente remove objetos, mas preserva metadados e não implementa exclusão de lotes. A lista antiga limita silenciosamente os resultados a 100.
- A fila local usa uma chave por lote e sempre consulta o servidor antes de enviar. Não há necessidade de alterar Gmail, campanhas, quotas ou identificação.

## Implementação

A migração aditiva `20261013000000_smart_batch_deletion.sql` registra solicitação, conclusão e falha de limpeza no lote, além de `import_active_at` no documento para identificar operações de importação ainda não encerradas. Esse marcador não expira para fins de exclusão: a recuperação deve terminar e liberá-lo. O registro mínimo concluído é conservado como tombstone para consulta idempotente; documentos e dados de configuração são removidos somente após tratar todos os objetos. Não existe CASCADE novo.

Somente DRAFT/READY, sem autorização de início, leases, agendamento ou conclusão, são elegíveis. Todos os itens (inclusive removidos) devem permanecer DRAFT, sem tentativas, processamento, IDs de mensagem, envio ou monitoramento. UPLOADING é bloqueado mesmo com lease vencido: deve ser reconciliado antes. Mensagens por referência RFC ou ID de anexo, eventos, logs conhecidos e duplicatas externas bloqueiam a exclusão. A confirmação revalida revisão e quantidade de documentos; alterações exigem nova prévia.

Uma trava transacional por proprietário serializa a reserva de uploads com a solicitação de exclusão. A solicitação bloqueia o lote e documentos, marca os documentos removidos e o lote CANCELLED. Novos uploads, recuperação, preparação e início ficam impedidos pelos estados existentes. A detecção de duplicatas permanece inalterada.

A limpeza usa o cron existente de PDFs, sem adicionar triggers, e alterna oportunidades entre retenção e exclusão. Desde a correção de 14/10/2026, cada oportunidade trata até cinco chaves do mesmo lote em um único DELETE múltiplo. Uma reserva persistente de 60s usa `lock_token`/`lock_until` apenas em lotes com exclusão autorizada e que nunca iniciaram envio. A transação de reserva termina antes da chamada ao Storage. Uma segunda transação confirma somente as chaves verificadas, condicionada ao mesmo token. Nenhum lock SQL fica aberto durante a rede. Objetos potencialmente gravados são tratados mesmo quando `file_ready=false`. Não se declara conclusão antes de confirmar todas as remoções. Anexos comuns de templates não são apagados.

A interface consulta prévia do servidor e exige confirmação visual. Até cinco lotes podem ser confirmados por solicitação, limitando trabalho no Worker. Bloqueados são apresentados individualmente. Listagem com pesquisa, filtro e paginação no servidor, 20 lotes por página. Após confirmação persistida, os lotes aceitos saem imediatamente da lista de trabalho; continuam acessíveis no filtro “Em exclusão”, com quantidade restante e erro. Somente essa visualização faz atualização automática a cada minuto, com aba visível e sem consulta anterior em andamento. A lista de trabalho não faz polling. Resultado de exclusão persiste após recarregar; somente a chave local do lote confirmado é removida.

## Implantação e limites

A migração existente `20261013000000_smart_batch_deletion.sql` é pré-requisito do gerenciamento. A correção de 14/10 não cria outra migração. `SMART_SEND_DELETE_FILES` configura o tamanho do grupo entre 1 e 5, padrão 5 e teto 5; valores acima do teto são limitados. A configuração aparece em `.env.example`. Não executar deploy ou migração de produção como parte dos testes.

A exclusão é assíncrona; aguarda o cron de PDFs e pode demorar conforme a fila. Falhas mantêm a solicitação pendente com mensagem para acompanhamento. Lotes cancelados, mesmo aparentemente vazios, são conservadoramente bloqueados. Importações abandonadas em UPLOADING precisam ser reconciliadas; não se presume que uma requisição lenta terminou. O tombstone não contém destinatários, documentos ou conteúdo de mensagens. Logs e mensagens reais nunca são apagados.

Com o agendamento atual de PDFs a cada oito minutos, há uma oportunidade de exclusão a cada **16 minutos**, compartilhada pela fila; cada oportunidade remove até cinco chaves e já finaliza os metadados se não restar objeto pendente. Enquanto houver exclusões, a retenção tem a outra oportunidade, também a cada 16 minutos. Sem exclusões, a retenção continua podendo rodar a cada oito minutos. A alternância agora usa o horário do evento, não o relógio de entrega atrasada. A vazão aumenta até cinco vezes sem adicionar eventos ou juntar retenção e exclusão na mesma execução. Isso não constitui garantia de CPU no Free; veja as medições e limitações abaixo.

## Endpoints

- `GET /api/smart-sends/batches`: pesquisa (`search`), status, ordem (`order=oldest`) e página baseada em zero (`page`). Sem status, exclui solicitações de exclusão da lista de trabalho; `status=DELETING` lista apenas as pendentes.
- `POST /api/smart-sends/deletion-preview`: `{ "ids": [1] }` retorna elegibilidade e motivos sem modificar o lote.
- `POST /api/smart-sends/deletion-request`: `{ "confirmed": true, "batches": [{ "id": 1, "revision": 0, "documents": 2 }] }` retorna 202 e resultado individual. IDs e contagens são revalidados, não são autoridade sobre o servidor.
- `GET /api/smart-sends/1/deletion`: consulta autenticada do comprovante persistente (`pending`, `deleted` ou `not-requested`), erro e `pendingFiles`.

## Validação local da implementação inicial (13/10/2026)

261 testes automatizados passaram: gerenciamento, importação, segurança, identificação, cron, campanhas, Gmail, anexos e envio individual. TypeScript, lint e build de produção passaram. O teste de gerenciamento no Edge headless passou quatro verificações de fluxo cobrindo desktop/mobile, prévia, cancelamento, confirmação múltipla, preservação de bloqueados, filas locais, atualização e recarregamento. O teste visual existente de importação passou outras 21 verificações, incluindo 100 PDFs sintéticos, recuperação após recarregamento e navegação de volta ao lote. Todas as APIs do navegador foram simuladas. Evidências em `outputs/smart-batch-tests.txt`, `outputs/smart-batch-build.txt`, `outputs/smart-batch-qa/` e `outputs/smart-qa/` (ignoradas pelo Git).

Testes de banco usam PGlite e migrações reais em ambiente sintético; Storage e Gmail usam mocks. Chamadas concorrentes são testadas em PGlite, que serializa conexões; isso não substitui ensaio de contenção em PostgreSQL de homologação. Nenhum lote real foi excluído, nenhuma mensagem foi enviada e nenhuma migração ou deploy foi executado em produção.

## Arquivos

Criados: `components/smart-sends/batch-manager.tsx`, `lib/smart-batch-management.ts`, `supabase/migrations/20261013000000_smart_batch_deletion.sql`, `scripts/test-smart-batch-management.mjs`, `scripts/test-smart-batch-ui.mjs` e este documento.

Modificados: `app/smart-sends-page.tsx`, `app/smart-sends.css`, `app/api/smart-sends/[[...path]]/route.ts`, `lib/smart-send-service.ts`, `lib/smart-import-client.ts`, `db/schema.ts`, `scripts/test-smart-ui.mjs` e `.gitignore`.

## Correção de lentidão e independência — 14/10/2026

### Causas e limites da investigação

A causa da lentidão foi confirmada no código: uma oportunidade a cada 16 minutos, um objeto por execução e mais uma execução para finalizar metadados. Nove chaves exigiam dez oportunidades, podendo levar aproximadamente 160 minutos sem disputa de fila.

A exclusão pendente, por si só, não ativava `busy` da página. Foram identificados mecanismos distintos:

- `Novo lote` estava desabilitado enquanto o GET de templates permanecia em andamento. Essa dependência era desnecessária para criar/listar lotes e foi removida. No navegador, uma requisição de templates mantida aberta já não impede criar ou abrir outro lote.
- `BatchManager.working` bloqueava todos os botões “Abrir lote” durante uma verificação/solicitação de exclusão. Agora o bloqueio dessa operação se limita aos IDs envolvidos. A confirmação modal continua exigindo uma decisão explícita do usuário.
- O cleanup anterior mantinha o lock do lote e uma transação abertos durante o DELETE remoto. Uma solicitação repetida/prévia sobre esse lote podia aguardar esse lock enquanto segurava o advisory lock do proprietário, também usado por reservas de importação. O novo cleanup libera a transação antes da rede e usa um lease persistido, sem ampliar a trava por proprietário.
- Lotes pendentes apareciam por padrão junto aos utilizáveis, gerando polling de 15s. Agora estão separados; polling de 60s só ocorre na visualização de exclusão aberta/visível. A confirmação atualiza a lista local imediatamente após o ACK do backend, sem aguardar o próximo GET.

O cenário de espera do Storage foi executado contra a implementação anterior, lida por `git show`, em banco descartável: falhou com `operations waited for Storage`. A mesma sequência passou com a correção, incluindo criação, consulta, upload, solicitação repetida e segunda tentativa de cleanup. Evidência local: `outputs/deletion-baseline/result.txt`. **PGlite serializa conexões**: essa reprodução comprova a transação longa no harness, mas não mede quais operações bloqueariam num PostgreSQL real com múltiplas conexões. A cadeia de row lock/advisory lock foi identificada por inspeção; deve ser verificada em homologação. Não foram acessados logs de produção para atribuir o relato a uma causa única; 1102, falhas HTTP e consultas lentas continuam hipóteses operacionais possíveis.

### Confirmação do Storage e recuperação

O grupo contém somente IDs selecionados do lote autorizado, com proprietário conferido e chave exata `smart-sends/<id>.pdf`. Caminhos arbitrários, grupos acima de cinco e estados incompatíveis são recusados antes do DELETE. Não há DELETE SQL em tabelas internas do Storage.

Uma chamada à API confirma bucket privado, seguida de um DELETE com `prefixes` contendo as chaves exatas. A resposta precisa ser uma lista válida de objetos cujos nomes pertencem ao grupo. Só as chaves retornadas são confirmadas. Para chaves omitidas, a API de metadados verifica ausência explícita (`NoSuchKey` ou a resposta legada específica de objeto inexistente). HTTP 2xx vazio, 404 genérico, bucket ausente, erro de autenticação e metadados inválidos não confirmam remoção. [Remoção pelo Storage](https://supabase.com/docs/guides/storage/management/delete-objects), [implementação oficial de remoção e metadados](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts).

Se alguns objetos forem confirmados e outros não, apenas os confirmados recebem `file_deleted_at`. Os demais permanecem rastreáveis, com erro no lote. DELETE com resultado desconhecido não descarta metadados. Depois de uma interrupção antes da finalização, o lease expira em 60s e a próxima oportunidade retoma; objetos já ausentes são reconciliados. O token impede uma resposta antiga de finalizar ou liberar a reserva de outro worker. Ausência de pendências permite apagar os metadados dos documentos e reduzir o lote a tombstone na própria execução do último grupo.

As regras de elegibilidade e proteção de histórico continuam: somente lotes nunca iniciados, confirmação explícita, nenhuma importação ativa, nenhuma referência externa, mensagem ou evento de entrega que deva ser preservado. O envio Gmail, parsing PDF, identificação de CNPJ, destinatários e campanhas não foram alterados.

### Frequência e capacidade

Os três triggers do projeto permanecem iguais; não se consultou a conta para presumir disponibilidade adicional e não se criou outro agendamento. Campanhas tradicionais seguem a cada minuto, Envios Inteligentes a cada dois minutos e cada categoria de manutenção a cada oito minutos. A retenção conserva sua oportunidade reservada. `worker.ts` passa o horário do evento para a alternância interna de arquivos.

Com grupo padrão de cinco, um lote isolado, eventos pontuais e nenhuma falha:

| Chaves pendentes | Oportunidades necessárias | Espera estimada máxima até concluir |
|---|---:|---:|
| 0 | 1 | ~16 min |
| 5 | 1 | ~16 min |
| 9 | 2 | ~32 min |
| 20 | 4 | ~64 min |
| 100 | 20 | ~320 min |

São estimativas de fila, não SLA: outros lotes, erros e atrasos do cron aumentam esses tempos. A ordenação por `updated_at` distribui oportunidades entre lotes. Não há loop para esvaziar a fila inteira numa invocação. A escolha mantém a frequência das outras tarefas, em vez de tomar suas oportunidades de manutenção.

### Recursos medidos em workerd

`node scripts/profile-smart-deletion.mjs` compila o código real de cleanup e Storage e usa Miniflare/workerd com V8 CPU Profiler via CDP. As requisições de Storage são interceptadas localmente e contadas; nenhum recurso externo é acessado. PostgreSQL é um double: a construção das expressões Drizzle e a orquestração são reais, mas conexão, TLS, execução SQL e decodificação dos resultados reais não são medidos. Testes de correção de banco usam PGlite separadamente.

Resultado final, sem testes/build concorrentes:

| Cenário por invocação | Repetições | Tempo decorrido médio | Tempo atribuído a amostras ativas | Fetches Storage |
|---|---:|---:|---:|---:|
| Grupo de 5, primeira execução | 1 | 122,00 ms | 106,84 ms | 2 |
| Lote vazio | 30 | 3,91 ms | 2,98 ms | 0 |
| Grupo de 1 | 30 | 6,54 ms | 5,98 ms | 2 |
| Grupo de 5 | 30 | 6,12 ms | 5,33 ms | 2 |
| Primeiro grupo de lote com 20 | 30 | 5,67 ms | 4,86 ms | 2 |
| Retentativa com 5 objetos já ausentes | 30 | 11,75 ms | 9,27 ms | 7 |

O caminho normal usa **2 fetches por grupo**: bucket + DELETE múltiplo. O pior caso testado usa **7**: bucket + DELETE + cinco consultas de ausência. Chamadas são sequenciais e seus corpos são consumidos/cancelados; não se abrem cinco downloads de PDF. O timeout do DELETE e das verificações é compartilhado de 15s, além do timeout de até 10s da consulta do bucket. O tamanho máximo de resposta analisada é 64 KiB para DELETE e 4 KiB por resposta de erro de metadados.

O double contou 5 operações de banco/1 transação para lote vazio, 8 operações/2 transações para grupo não final e 9 operações/2 transações para o grupo final. BEGIN/COMMIT adicionam comandos no driver real. A contagem de fetches não deve ser apresentada como contagem total de subrequests/conexões do Worker, pois o PostgreSQL real não estava ligado ao harness.

**Não é possível certificar conformidade de CPU do Workers Free com este teste local.** A estimativa de amostras soma intervalos de frames ativos, excluindo idle/program/root; sofre overhead do inspector, agendamento do host e atribuição imprecisa de tempo. Não é a métrica faturada da Cloudflare. A execução fria ultrapassou bastante o orçamento de referência; a retentativa também deixa pouca margem se comparada diretamente a 10ms, comparação que não equivale a uma medição de produção. Não se deve ocultar esse resultado nem afirmar resolução de 1102 apenas pelo sucesso local.

A documentação consultada publica 10ms de CPU por Cron no Free e 50 subrequests externos. A espera de rede não conta como CPU, mas parsing, driver e inicialização contam. O limite efetivo deve ser verificado na conta/versão em homologação. A correção não altera limites nem presume possibilidade de adicionar cron. [Limites oficiais](https://developers.cloudflare.com/workers/platform/limits/), [profiling oficial](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).

O grupo de cinco foi mantido porque o teste aquecido não mostrou aumento mensurável sobre um objeto e reduz execuções por arquivo, sempre limitado. `SMART_SEND_DELETE_FILES=1` permite reduzir o grupo sem mudar código durante validação operacional; isso não elimina custos fixos nem garante que uma inicialização fria caiba no Free. Uma futura mudança para Paid pode reutilizar o mesmo protocolo e leases; qualquer aumento acima do teto exige nova avaliação.

### Testes e arquivos desta correção

**285 testes passaram**, incluindo exclusão vazia/5/20 PDFs, falha parcial, resposta perdida, Worker interrompido, lease vencido, concorrência, resultado tardio, novo lote durante Storage parado, consulta/upload em outro lote, preservação de objetos alheios e histórico Gmail. Foram executadas também todas as regressões locais de campanhas, quotas, OAuth, anexos, importação, segurança e agendamentos.

**7 verificações de navegador passaram** em Edge headless, desktop/mobile, com APIs simuladas: templates pendentes, prévia/cancelamento, confirmação múltipla, nova criação durante limpeza, abertura de outro lote, atualização/conclusão, reload/pesquisa. A visualização pendente foi inspecionada por screenshot. Não houve envio ou remoção de documentos reais.

TypeScript, lint completo do repositório, `git diff --check` e build de produção local passaram. Logs/perfis/screenshots ficam em `outputs/smart-deletion-tests.txt`, `smart-deletion-lint.txt`, `smart-deletion-build.txt`, `smart-deletion-cpu/` e `smart-batch-qa/`, ignorados pelo Git.

Arquivos de aplicação alterados: `lib/smart-batch-management.ts`, `lib/smart-send-storage.ts`, `lib/smart-send-service.ts` (somente horário da limpeza), `worker.ts` (argumento de horário), `components/smart-sends/batch-manager.tsx`, `app/smart-sends-page.tsx` e `.env.example`. Atualizados testes de gerenciamento, interface e cron; adicionados `scripts/test-smart-deletion-storage.mjs` e `scripts/profile-smart-deletion.mjs`. `lib/worker-schedule.ts` foi inspecionado e permaneceu inalterado. Nenhuma migração nova.

### Validação operacional restante

Em homologação isolada, confirmar CPU real fria/quente, subrequests totais e ausência de `exceededCpu` para grupos 1/5 e retentativa de objetos ausentes. Medir p95/máximo, não apenas média. Reproduzir latência/timeout do Storage com conexões PostgreSQL independentes, conferir que `pg_locks` não mostra transação de cleanup aberta durante a espera e que criação/consulta/importação de outros lotes continuam. Verificar respostas reais da versão do Supabase para DELETE parcial e objeto inexistente; formatos desconhecidos devem permanecer pendentes. Repetir falha após DELETE e antes do commit, confirmar mesmos IDs/chaves e nenhum reenvio Gmail.

A fila ainda é deliberadamente lenta sob volume alto para conservar os agendamentos. Erros persistentes exigem corrigir a causa externa; a interface mostra o erro e mantém registros. A reserva expirada recupera na próxima oportunidade, não imediatamente após 60s. Não houve deploy, exclusão em produção, mudança de plano ou aumento artificial de limites.
