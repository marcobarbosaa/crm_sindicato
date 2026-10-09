# Correção de Cron Triggers — Workers Free

## Configuração corrigida em 08/10/2026

O build configura **três triggers**, definidos em `lib/worker-schedule.ts` e compartilhados entre Vite e Worker:

| Trigger | Trabalho |
| --- | --- |
| `* * * * *` | Campanhas tradicionais, a cada minuto (sem mudança) |
| `1-59/2 * * * *` | Envios Inteligentes, a cada dois minutos (sem mudança) |
| `*/2 * * * *` | Uma única tarefa de manutenção, alternada pelo horário do evento |

| Tarefa | Frequência anterior | Frequência nova | Minuto UTC módulo 8 |
| --- | --- | --- | --- |
| Devoluções tradicionais | 2 minutos | 8 minutos | 0 |
| Devoluções inteligentes | 3 minutos | 8 minutos | 2 |
| Limpeza de anexos tradicionais | 5 minutos | 8 minutos | 4 |
| Limpeza de PDFs inteligentes | 5 minutos | 8 minutos | 6 |

As frequências são oportunidades de execução: os próprios serviços continuam respeitando seus checkpoints, leases, janelas e próximos horários. Relatórios de devolução e limpeza podem atualizar mais tarde que antes. Não muda a janela de retenção nem a janela de análise de devoluções.

Cada evento executa **somente uma tarefa existente**. Não há Promise.all, fan-out, loop de recuperação de horários perdidos nem soma de duas tarefas pesadas. Mantêm-se os limites existentes (um bloco de campanha, um envio inteligente, uma página de devoluções, até 25 anexos ou cinco PDFs por limpeza). Assim, CPU, tempo e subrequests de cada invocação não recebem carga adicional de outro serviço. A seleção do slot é local, sem I/O adicional.

O slot usa `controller.scheduledTime`, nunca Date.now ou contador em memória: atraso ou reinicialização não alteram o trabalho escolhido. Eventos desconhecidos/retirados durante a propagação são ignorados explicitamente. Falha em um slot é registrada e não executa outra tarefa como fallback. As próximas execuções continuam normalmente.

Nenhuma lógica de envio, lease, idempotência, quota, recuperação ou barreira Gmail foi alterada. A entrega repetida de eventos continua protegida pelos mecanismos persistentes dos runners; não se introduziu nenhuma nova chamada de envio em manutenção.

## Auditoria remota somente leitura

Na conta autenticada pelo Wrangler, em 08/10/2026:

| Worker | Triggers ativos |
| --- | --- |
| `crm-sindicato` | 3: `* * * * *`, `*/2 * * * *`, `*/5 * * * *` |
| `grupobolao1-0` | 0 |
| `joguinhodc` | 0 |
| `prospecta-crm` | 0 |

Total observado: três. Os seis triggers locais da implementação anterior não estavam registrados. Com a substituição por três, o total esperado da conta continua três, deixando dois slots livres no limite de cinco informado pela Cloudflare. Esse inventário é um snapshot; deve ser conferido novamente se outros Workers receberem crons antes da publicação. Nenhum trigger remoto foi alterado durante esta correção.

As consultas usaram apenas GET de Workers, schedules e settings. O relatório local ignorado pelo Git (`outputs/cloudflare-cron-audit.json`) contém nomes/contagens e nomes/tipos de bindings, sem valores ou credenciais.

## Divergência de configuração e preservação de variáveis

O build de publicação já gerava `vars: {}`, mas não declarava `keep_vars`. A configuração local é normalmente a fonte de verdade do Wrangler; variáveis simples criadas pelo painel podem ser removidas sem preservação explícita. Secrets têm tratamento distinto; não há evidência de que tenham sido apagados pelo deploy que falhou.

Agora `vite.config.ts` declara `keep_vars: true`, e `scripts/deploy.mjs` passa também `--keep-vars`. Antes de publicar, `scripts/deploy-policy.mjs` verifica que o artefato tem três crons, `keep_vars: true` e nenhum valor em `vars`. Isso impede que um build local com DATABASE_URL sobrescreva um binding remoto. Nenhum secret é copiado para a configuração nem reenviado por arquivo.

Referência: [configuração oficial do Wrangler — keep_vars](https://developers.cloudflare.com/workers/wrangler/configuration/). O aviso geral de diferença entre configurações ainda pode aparecer por mudanças intencionais em triggers ou outras propriedades; preservar variáveis não significa ocultar todas as diferenças.

Na consulta remota, estavam presentes como secrets: `SMART_SEND_OWNER_MAP`, `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ATTACHMENTS_BUCKET` e `ATTACHMENTS_CLEANUP_SECRET`. Os valores não foram impressos nem gravados.

**Não foram encontrados no Worker consultado:** `SMART_SEND_ACCESS_ISSUER`, `SMART_SEND_ACCESS_AUD` e `SMART_SEND_BUCKET`. Esta correção não inventa nem altera esses valores. Configurá-los no painel é necessário para operar Envios Inteligentes hospedado; `keep_vars` preserva bindings existentes, mas não cria os ausentes.

## Verificação e publicação

Não executar `scripts/deploy.mjs` para apenas validar: ele publica. Para produzir o artefato de produção sem publicar:

```powershell
$env:CLOUDFLARE_DEPLOY = '1'
corepack pnpm build
# Inspecionar apenas os campos não sensíveis:
$config = Get-Content dist/server/wrangler.json -Raw | ConvertFrom-Json
$config.triggers.crons
$config.keep_vars
```

Resultado esperado: três crons da tabela, `keep_vars = true` e `vars` vazio. Publicação posterior permanece manual e deve usar `scripts/deploy.mjs`, que mantém o nome explícito `crm-sindicato`. Não houve deploy, alteração de banco ou envio real nesta correção.

Testes adicionados cobrem um dia completo (1.440 oportunidades de campanhas, 720 de envios inteligentes e 180 por manutenção), isolamento de falhas, reinício, evento repetido, crons retirados e validação do artefato/variáveis. Também são executadas as suítes existentes de campanhas, Envios Inteligentes, Gmail/anexos, TypeScript, lint e build.

Resultado local: **180 testes aprovados**, TypeScript e lint sem erros, build de produção concluído. `dist/server/wrangler.json` validado com três crons, `keep_vars: true` e `vars: {}`. Evidências locais ignoradas pelo Git: `outputs/cron-regressions.txt` e `outputs/cron-production-build.txt`. Testes usam dados sintéticos e provedores simulados; não houve envio real.
