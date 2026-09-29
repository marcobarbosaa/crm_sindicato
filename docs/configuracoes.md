# Reestruturação de Configurações

## Resultado

Central com Geral, Gmail, E-mails, Envios, Follow-ups, Dados e Segurança.
Layout com navegação interna, conteúdo e contexto somente onde existem informações úteis.
No mobile, a navegação interna vira um select e o botão da sidebar principal permanece disponível.
O cabeçalho global e a ação Nova empresa não aparecem em Configurações; CompanyDialog permanece nos demais módulos.

As abas usam `?settings=general|gmail|emails|sending|followups|data|security`.
Os rascunhos são preservados entre abas. Sair da central ou recarregar com alterações exige confirmação.
O salvamento é manual, bloqueia envio duplicado e campos durante o PATCH, valida o limite e apresenta feedback de sucesso/erro.

## Arquivos criados

- `app/settings/navigation.tsx`: navegação e metadados das sete abas.
- `app/settings/config-sections.tsx`: Geral, E-mails, Envios e indicadores de envio.
- `app/settings/gmail-settings.tsx`: integração, permissões, desconexão e teste de envio.
- `app/settings/data-sections.tsx`: Follow-ups, Dados e Segurança.
- `app/settings/shared.tsx`: cards, indicadores, skeletons, erros e datas.
- `app/settings/use-settings-resource.ts`: carregamento cancelável, cache enquanto montado e retry.
- `app/settings/types.ts`: contratos tipados da interface.
- `app/settings/settings.css`: estilos responsivos isolados.
- `app/api/settings/summary/route.ts`: agregações reais para indicadores e histórico de importações.
- `lib/settings.ts`: tipo/defaults das configurações e janela diária de envio.
- `scripts/test-settings-timezone.mjs`: testes de virada de dia.
- `scripts/test-settings-ui.mjs`: testes no Edge headless com APIs simuladas.
- `docs/configuracoes.md`: este relatório.

## Arquivos modificados

- `app/settings-page.tsx`: coordenação da central, estado editado, salvamento e recursos compartilhados.
- `app/crm-app.tsx`: integração, URLs, proteção de rascunhos, cabeçalho contextual e hidratação.
- `app/globals.css`: importação dos novos estilos e remoção do CSS obsoleto de Configurações.
- `app/api/settings/route.ts`: validação e atualização parcial segura.
- `app/api/gmail/status/route.ts`: exposição dos scopes armazenados, sem credenciais.
- `app/api/emails/route.ts`, `app/api/email-batches/route.ts` e `lib/campaign-runner.ts`: contagem diária no fuso salvo.
- `app/api/dashboard/route.ts`: mesma contagem diária; prazo dos follow-ups permanece em Brasília.

## Banco e APIs

Nenhuma mudança no schema ou migration. Nenhum dado real foi alterado durante a validação.

- GET /api/settings preservado.
- PATCH /api/settings passa a validar tipos, limites inteiros de 1 a 500, tamanhos de texto e os dois fusos aceitos. Atualizações parciais preservam os campos ausentes.
- GET /api/settings/summary fornece totais, uso diário, tentativas com falha, follow-ups e as cinco últimas importações, filtrados pelo mesmo proprietário utilizado no CRM.
- GET /api/gmail/status inclui os scopes efetivamente registrados.
- O teste de Gmail reutiliza POST /api/emails, incluindo validações, assinatura salva, histórico, proteção contra repetição e limite diário.
- Endpoints de envio e campanhas passam a considerar o fuso configurado, incluindo o período UTC anterior à meia-noite em Brasília.

## Configurações persistentes

Continuam persistidas no banco: nome do remetente, assinatura em texto simples de até 2000 caracteres, limite diário e fuso (Brasília/UTC).
Não foram adicionadas preferências sem efeito real.
O fuso agora controla a janela diária dos envios; não altera os prazos de follow-ups, que continuam em Brasília.

## Recursos existentes reutilizados

OAuth Gmail; data da conexão; permissões armazenadas; desconexão; envio e histórico de mensagens; assinatura automática; limite diário; lote rápido com teto de 20 destinatários; campanhas com ritmo próprio; templates; follow-ups manuais; histórico de importações; exportação Excel na listagem de empresas.

## Recursos novos

Navegação em sete abas com links diretos; salvamento com dirty state e proteção contra perda; prévia textual de assinatura; teste explícito de Gmail; resumos agregados do banco; tabela das últimas importações; atalhos para os módulos existentes e exportação; estados independentes de loading/erro/retry; apresentação fiel do modo de acesso local.

Os indicadores de envio exibem o limite salvo, não uma alteração ainda pendente. A atualização ocorre ao carregar, salvar, enviar um teste ou clicar em Atualizar dados; não há promessa de atualização contínua.

## Elementos dos mockups omitidos

- Senha, sessões/dispositivos, último acesso, localização, 2FA e atividade de login: o CRM utiliza proprietário local fixo e não possui autenticação individual ou rastreamento dessas informações.
- Follow-ups automáticos, lembretes e resumos por e-mail: não existe execução dessas regras nem sistema de notificações. O runner de campanhas não implementa esses acompanhamentos.
- Preferências de idioma, formatos, paginação e visualização: não existe aplicação dessas preferências no conjunto do CRM.
- Prazo padrão global de follow-ups: o módulo atual recebe explicitamente a data de cada acompanhamento.
- Reply-To, cópia, assinatura opcional e histórico opcional: não há esses comportamentos configuráveis na pipeline atual.
- Editor rich-text: os envios usam texto simples; a prévia acompanha exatamente esse formato.
- Intervalos globais mínimo/máximo e switches de pausa/notificação: o ritmo é configurado por campanha no módulo existente.
- Exportação de contatos/histórico: não existe fluxo reutilizável equivalente; foi mantida a exportação de empresas já implementada.
- Exclusão de dados antigos e remoção de duplicidades: faltam critérios e fluxo de revisão.
- Região/status nas importações: o histórico não armazena esses campos; são exibidos os totais realmente registrados, incluindo atualizações e erros.
- Status de segurança, backups, percentuais de capacidade e dados pessoais ilustrativos: não existe base real para essas afirmações.
- Autosave: não foi implementado; o salvamento é explícito.

## Validação

- Lint: aprovado, sem erros ou avisos.
- TypeScript: aprovado com `npx tsc --noEmit`.
- Build: aprovado; aviso não impeditivo de chunks maiores que 500 kB.
- Cinco testes de fronteiras temporais aprovados (UTC, Brasília e virada do ano).
- Interface: sete abas; preservação de rascunho; sucesso/erro no salvamento; limite inválido; Gmail conectado/desconectado; teste de envio simulado; falha/retry do Gmail; loading/erro/empty; navegação back/forward e refresh; menu mobile; nenhuma duplicação de GET settings entre abas.
- Responsividade: 1536, 820 e 390 pixels, sem overflow da página; capturas revisadas visualmente.
- Smoke de navegação: Visão geral, Empresas, Contatos, E-mails, Envio em lote, Templates, Importações e Follow-ups.
- Console: sem erros na execução final dos testes.
- APIs reais: GET settings, summary e Gmail status retornaram 200; PATCH inválido retornou 400 para limite 0, 501, fracionário, fuso inválido e assinatura acima de 2000 caracteres.

A interface foi validada com respostas simuladas. Não foi realizado envio externo, autorização OAuth real, nem gravação de configurações no banco do usuário. O smoke dos demais módulos cobre navegação/renderização, não todos os seus fluxos de edição.

Capturas e relatório automatizado: `outputs/settings-qa/`.

Execução: `node scripts/test-settings-timezone.mjs` e, com o servidor pronto, `node scripts/test-settings-ui.mjs`.
O teste de interface aceita `SETTINGS_TEST_URL` e `CHROME_BINARY`; por padrão usa localhost:5173 e Microsoft Edge no Windows.
