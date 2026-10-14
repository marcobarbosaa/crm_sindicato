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

A limpeza usa o cron existente de PDFs, sem adicionar triggers. Alterna oportunidades entre retenção e exclusão. Cada execução de exclusão trata no máximo um objeto com timeout de 15s. O lock do lote serializa workers; falha ou reinício mantém os metadados e repete o DELETE idempotente. Objetos potencialmente gravados são tratados mesmo quando `file_ready=false`. Não se declara conclusão antes de confirmar todas as remoções. Anexos comuns de templates não são apagados.

A interface consulta prévia do servidor e exige confirmação visual. Até cinco lotes podem ser confirmados por solicitação, limitando trabalho no Worker. Bloqueados são apresentados individualmente. Listagem com pesquisa, filtro e paginação no servidor, 20 lotes por página. Resultado de exclusão persiste após recarregar; somente a chave local do lote confirmado é removida.

## Implantação e limites

Aplicar a migração antes de publicar o código, mediante autorização operacional. Nenhuma variável adicional. Não executar deploy ou migração de produção como parte dos testes.

A exclusão é assíncrona; aguarda o cron de PDFs e pode demorar conforme a fila. Falhas mantêm a solicitação pendente com mensagem para acompanhamento. Lotes cancelados, mesmo aparentemente vazios, são conservadoramente bloqueados. Importações abandonadas em UPLOADING precisam ser reconciliadas; não se presume que uma requisição lenta terminou. O tombstone não contém destinatários, documentos ou conteúdo de mensagens. Logs e mensagens reais nunca são apagados.

Com o agendamento atual de PDFs a cada oito minutos, há uma oportunidade de exclusão a cada **16 minutos**, compartilhada pela fila; cada oportunidade remove até um objeto ou finaliza os metadados. Enquanto houver exclusões, a retenção tem a outra oportunidade, também a cada 16 minutos. Sem exclusões, a retenção continua podendo rodar a cada oito minutos. Para 100 PDFs, a limpeza pode levar mais de um dia. Aumentar essa vazão exige validar novamente o orçamento de execução; o limite deliberado evita sobrecarregar o Worker Free.

## Endpoints

- `GET /api/smart-sends/batches`: pesquisa (`search`), status, ordem (`order=oldest`) e página baseada em zero (`page`).
- `POST /api/smart-sends/deletion-preview`: `{ "ids": [1] }` retorna elegibilidade e motivos sem modificar o lote.
- `POST /api/smart-sends/deletion-request`: `{ "confirmed": true, "batches": [{ "id": 1, "revision": 0, "documents": 2 }] }` retorna 202 e resultado individual. IDs e contagens são revalidados, não são autoridade sobre o servidor.
- `GET /api/smart-sends/1/deletion`: consulta autenticada do comprovante persistente (`pending`, `deleted` ou `not-requested`).

## Validação local

261 testes automatizados passaram: gerenciamento, importação, segurança, identificação, cron, campanhas, Gmail, anexos e envio individual. TypeScript, lint e build de produção passaram. O teste de gerenciamento no Edge headless passou quatro verificações de fluxo cobrindo desktop/mobile, prévia, cancelamento, confirmação múltipla, preservação de bloqueados, filas locais, atualização e recarregamento. O teste visual existente de importação passou outras 21 verificações, incluindo 100 PDFs sintéticos, recuperação após recarregamento e navegação de volta ao lote. Todas as APIs do navegador foram simuladas. Evidências em `outputs/smart-batch-tests.txt`, `outputs/smart-batch-build.txt`, `outputs/smart-batch-qa/` e `outputs/smart-qa/` (ignoradas pelo Git).

Testes de banco usam PGlite e migrações reais em ambiente sintético; Storage e Gmail usam mocks. Chamadas concorrentes são testadas em PGlite, que serializa conexões; isso não substitui ensaio de contenção em PostgreSQL de homologação. Nenhum lote real foi excluído, nenhuma mensagem foi enviada e nenhuma migração ou deploy foi executado em produção.

## Arquivos

Criados: `components/smart-sends/batch-manager.tsx`, `lib/smart-batch-management.ts`, `supabase/migrations/20261013000000_smart_batch_deletion.sql`, `scripts/test-smart-batch-management.mjs`, `scripts/test-smart-batch-ui.mjs` e este documento.

Modificados: `app/smart-sends-page.tsx`, `app/smart-sends.css`, `app/api/smart-sends/[[...path]]/route.ts`, `lib/smart-send-service.ts`, `lib/smart-import-client.ts`, `db/schema.ts`, `scripts/test-smart-ui.mjs` e `.gitignore`.
