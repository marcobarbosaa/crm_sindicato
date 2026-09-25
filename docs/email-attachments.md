# Templates de e-mail e anexos

## Implementação

- Biblioteca compacta à esquerda; editor vazio pronto para criar o primeiro template, sem botões redundantes.
- Nome do template, assunto, mensagem, personalização, anexos e ações nessa ordem.
- Empresa, Contato, Cidade e Segmento inseridos no cursor/seleção do último campo editado. Estado e E-mail continuam compatíveis.
- Prévia com empresa e contato principal consultados remotamente, sem gravar essa seleção no template.
- Busca compartilhada entre E-mails, prévia e lote: 2 caracteres, debounce de 300 ms, 20 resultados e cancelamento de respostas obsoletas.
- Removido o carregamento de empresas pelo componente de navegação ao abrir Templates/E-mails/Lote. Dashboard consulta somente 5 empresas; a listagem geral de Empresas mantém sua arquitetura anterior.
- Corrigido o filtro de CNPJ vazio que fazia pesquisas textuais corresponderem a registros sem relação com o termo. Pesquisa textual passa a ignorar maiúsculas/minúsculas.
- Upload múltiplo, inclusão posterior e remoção individual. Salvamento/upload bloqueiam ações duplicadas; erros são apresentados. Troca de template, saída pelo menu e fechamento/recarregamento protegem alterações não salvas.
- E-mails herda os anexos do template, mas envia seus próprios IDs selecionados. Remover um anexo do envio não altera o template.
- Lote envia os anexos do template e permite selecionar até 20 empresas com a mesma busca remota.
- Duplicar template gera arquivos e IDs independentes.

## Banco e migração

Aplicar **supabase/migrations/20260925_email_attachments.sql antes do deploy**. A migração é aditiva e também está incorporada ao schema para instalações novas.

- Nova tabela template_attachments: ID UUID gerado no servidor, proprietário, template opcional, nome, MIME, tamanho, chave do objeto, upload concluído, criação e expiração.
- FK para template usa ON DELETE SET NULL, mantendo arquivos rastreáveis para limpeza.
- Índices de proprietário/template e expiração; RLS habilitada, sem políticas públicas.
- email_messages.attachments: JSONB com metadados (id, name, mimeType, size), padrão []. Não guarda bytes/base64.
- Templates e mensagens antigos permanecem válidos. Nenhuma tabela/coluna existente é removida.
- A migração não foi aplicada a um banco real durante esta tarefa.

## Storage de produção

Arquivos ficam no **Supabase Storage privado**, atrás de AttachmentStorage (put, get, remove). Nenhum filesystem temporário é usado para persistência.

1. Criar bucket privado crm-email-attachments no projeto Supabase. Configurar limite de 8 MiB por objeto e permitir os MIME types de ATTACHMENT_TYPES em lib/attachments.ts.
2. Configurar no Worker:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY como secret somente do servidor
   - SUPABASE_ATTACHMENTS_BUCKET=crm-email-attachments
   - ATTACHMENTS_CLEANUP_SECRET como secret longo, independente dos demais
   - Manter DATABASE_URL e as credenciais OAuth existentes.
3. Configurar um agendador para executar, a cada 5 minutos, POST /api/attachments/cleanup, com Authorization: Bearer seguido do ATTACHMENTS_CLEANUP_SECRET.
4. Monitorar resposta/execução da limpeza. Cada chamada processa até 25 arquivos; repetir chamadas enquanto houver lotes completos. O campo pending indica falhas dentro do lote, não o total global pendente.

O ID/chave de armazenamento é gerado no servidor; o nome fornecido nunca determina o caminho. O upload registra a linha no banco **antes** de armazenar o objeto. Assim, interrupções e uploads parcialmente concluídos permanecem rastreáveis. Uploads sem template expiram após 24 horas; arquivos removidos/substituídos ficam imediatamente elegíveis para limpeza. Exclusão no banco ocorre somente depois de remover o objeto do storage; falhas permanecem para retry. Locks transacionais coordenam salvamento, download e limpeza.

A limpeza agendada é necessária: o navegador não é responsável por remover arquivos abandonados. Arquivos específicos de um envio expiram após 24 horas; o histórico conserva seus metadados. Templates ativos não expiram. O cron e o bucket não são criados automaticamente pelo deploy.

A identificação de proprietário existente (local-preview-user) foi preservada. Não foi introduzido um novo sistema de autenticação. O bucket deve continuar privado, com acesso via servidor.

Referências: [Supabase: buckets privados](https://supabase.com/docs/guides/storage/buckets/fundamentals), [acesso ao Storage](https://supabase.com/docs/guides/storage/security/access-control).

## Limites e validação

Fonte central: lib/attachments.ts.

- Máximo de **10 arquivos**.
- Máximo de **8 MiB por arquivo**.
- Máximo de **12 MiB no total**, com margem para expansão base64 e memória do Worker.
- Nome normalizado NFC, até 180 caracteres, sem caminhos, controles ou quebras de linha.
- Tipos: PDF, TXT, CSV, PNG, JPG/JPEG, DOCX, XLSX e PPTX.
- Extensão e MIME devem corresponder. MIME vazio/genérico é normalizado pelo formato permitido.
- Backend verifica tamanho, quantidade, total e assinatura básica do conteúdo; limita também o corpo multipart recebido, mesmo sem Content-Length.
- O conjunto final é revalidado no salvamento e no envio, incluindo anexos herdados e adicionados em requisições anteriores.
- Seleções com IDs repetidos, indisponíveis, expirados ou pertencentes a outro proprietário/template são recusadas.
- Listar templates carrega somente metadados, nunca o conteúdo dos arquivos.

## APIs

| Rota | Alteração |
|---|---|
| POST /api/attachments | Recebe FormData com vários campos files; devolve metadados de uploads temporários |
| POST /api/attachments/cleanup | Rotina autenticada de limpeza de objetos expirados/desvinculados |
| GET /api/templates | Inclui attachments somente com metadados |
| POST/PATCH /api/templates | Aceita attachmentIds; texto e vínculo dos anexos são salvos em transação |
| POST /api/templates com sourceId | Mantém duplicação e copia os arquivos independentemente |
| DELETE /api/templates | Desvincula anexos para limpeza antes de excluir |
| POST /api/emails | Aceita attachmentIds; [] envia sem anexos; omissão herda os anexos do template |
| GET /api/emails | Inclui metadados dos anexos utilizados no histórico |
| POST /api/email-batches | Carrega os anexos uma vez por lote e reutiliza em cada MIME |
| GET /api/companies | Mantém API de busca/limite; corrige correspondência indevida de CNPJ e busca textual |

Para clientes anteriores, PATCH sem attachmentIds mantém os vínculos atuais.

## Gmail / MIME

encodeRawEmail continua produzindo raw em base64url para a Gmail API. Sem anexos, envia texto simples UTF-8. Com anexos, usa multipart/mixed, boundary aleatório, corpo e arquivos em base64 com linhas de 76 caracteres, Content-Type próprio e Content-Disposition attachment. Nomes Unicode usam parâmetros RFC 2231 com continuação; assunto e nome do remetente usam encoded-words UTF-8. CRLF em cabeçalhos é sanitizado. OAuth e escopos não foram alterados.

Referência: [Google: criação e envio de mensagens MIME](https://developers.google.com/workspace/gmail/api/guides/sending).

## Verificação

- node node_modules/typescript/bin/tsc --noEmit
- node scripts/run-framework.mjs build: build de produção, sem deploy.
- Lint completo executado; o projeto já contém erros de hooks/impureza em arquivos preexistentes. O novo editor e os componentes/serviços novos passam no lint isolado.
- node --test scripts/test-email-attachments.mjs: cinco testes; exige Python no PATH para analisar MIME com um parser independente. Cobre corpo/remetente/assunto UTF-8, arquivos com nomes repetidos/Unicode/longos, recuperação byte a byte, cabeçalhos e limites.
- node scripts/email-ui-harness.mjs, seguido de node scripts/test-email-ui.mjs: testes no Edge headless com APIs simuladas. CHROME_BINARY pode indicar outro Chromium. O harness usa porta 5174; o navegador usa 9333 e perfil isolado em outputs/attachments-qa.
- Interface verificada: estado vazio, cursor nos dois campos, múltiplos uploads, remoção, salvar/recarregar, prévia com empresa/contato, herança, remoção apenas no envio, inclusão de arquivo específico, histórico, envio sem anexos e consultas de empresas limitadas.
- Capturas desktop/mobile e relatório de requisições: outputs/attachments-qa.
- O runtime local do Cloudflare falhou na inicialização com erro interno; os testes de UI foram feitos com os mesmos componentes React no harness Vite, sem usar aquele runtime.

**Não validados contra serviços reais:** migração/persistência no Supabase, upload/download/limpeza no bucket e recebimento pelo Gmail. Nenhum e-mail real foi enviado e nenhum deploy foi realizado. Após configurar produção, validar criar/salvar/recarregar com anexos, exclusão/limpeza, envio a uma caixa controlada (com e sem anexos) e histórico.

## Arquivos

Criados:
- lib/attachments.ts
- lib/attachment-storage.ts
- lib/attachment-service.ts
- components/company-search.tsx
- components/email-attachments.tsx
- components/template-preview.tsx
- app/api/attachments/route.ts
- app/api/attachments/cleanup/route.ts
- supabase/migrations/20260925_email_attachments.sql
- scripts/test-email-attachments.mjs
- scripts/test-email-ui.mjs
- scripts/email-ui-harness.mjs
- docs/email-attachments.md

Alterados:
- app/templates-page.tsx, app/emails-page.tsx, app/batch-emails-page.tsx
- app/crm-app.tsx, app/globals.css
- app/api/templates/route.ts, app/api/emails/route.ts, app/api/email-batches/route.ts, app/api/companies/route.ts
- db/schema.ts, supabase/schema.sql
- lib/gmail.ts, .env.example
