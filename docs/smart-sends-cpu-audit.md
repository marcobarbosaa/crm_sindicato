# Envios Inteligentes: auditoria de CPU

Data: 14/10/2026. Referência: `896820cb5b27106628208237e621b2638b1403a3`.

As otimizações estão implementadas e testadas localmente. **Não está demonstrado que o processamento PDF caiba no Workers Free.** A correção do incidente em produção depende de validar o plano/limite efetivo e medir a aplicação publicada em homologação. Nenhum deploy, contratação, envio Gmail real ou alteração de banco de produção foi realizado.

## Evidências e causas

Os logs fornecidos pelo operador indicam `Worker exceeded CPU time limit`/1102 em upload, detalhe e import-status. Não há evidência de migração ausente ou de JSON como causa primária. Não acessamos os logs remotos, a configuração da conta nem os PDFs envolvidos no incidente de 13/10 às 22h43 BRT.

Confirmado no código e no ambiente local:

- O upload reserva o registro, grava o objeto privado, confirma `fileReady` e executa todo o parsing PDF na mesma requisição HTTP. O limite de páginas só pode ser conferido depois de inicializar/abrir o documento. PDFs comprimidos pequenos podem conter muitas operações de texto.
- O serviço de consulta compartilhava seu módulo com upload, mutações, Gmail e o wrapper `unpdf`. **O PDF.js principal já era dinâmico no build anterior.** Não se confirmou carregamento do parser de 1,6 MB em GET. Isolar o wrapper e o serviço reduz dependências; não elimina 1,6 MB de parsing dos GETs.
- O detalhe fazia `select *` de itens/configurações, filtrava elegíveis repetidamente, fazia busca linear por elegibilidade e cruzava todas as sugestões com cada item. Agora há projeções SQL explícitas, contagem em uma passagem e índice de sugestões por ID.
- A validação Zod de IDs percorria/copiava objetos de detalhe e gerava trabalho de união/coerção para muitos IDs em string. O perfil isolado confirma esse custo. A normalização agora verifica os mesmos formatos/limites em campos explícitos, copia apenas os objetos necessários e recorre ao schema/diagnóstico sanitizado nas falhas.
- O upload extraía os mesmos CNPJs duas vezes. O resultado da primeira extração agora é reutilizado no matcher.
- SHA-256 já usa Web Crypto. JWT RS256 já verifica assinatura, issuer, audience e claims, com cache de JWKS. Nenhuma dessas verificações foi removida. Hash de arquivo grande também consome CPU; não é gratuito.

Ainda hipotético ou não medido:

- Atribuição exata dos 1102 em produção: PDF, hash, JWT, PostgreSQL/TLS, inicialização do framework, serialização ou combinação desses custos.
- Plano Free/Paid e limite realmente aplicado à versão que falhou. Não se inferiu o plano a partir do código.
- CPU de PostgreSQL/driver/TLS em uma requisição completa e influência de conexões novas. `withCampaignDb` continua usando cliente por invocação, `max: 1`, sem cache global de sockets; não há evidência que justifique alterar esse isolamento.
- PDFs reais com fontes, imagens, xref/object streams e estruturas diferentes das fixtures. Os testes sintéticos não esgotam esses casos.

## Alterações

`smart-send-queries.ts` contém detalhe, estado de importação e catálogo. `smart-send-scope.ts` mantém os filtros de proprietário/lote. A rota usa esses módulos diretamente e importa mutações sob demanda. O serviço mantém reexports para seus consumidores existentes. O leitor PDF só é importado no upload depois de persistir o armazenamento.

O detalhe mantém assunto/corpo de cada mensagem para a prévia obrigatória, candidatos, sugestões, destinatário, hash, confirmações, status, erros e datas necessários à interface/CSV. Chaves de armazenamento, proprietário e controles internos de entrega não entram nessa projeção. Esses campos continuam no banco e nas consultas completas do envio, recuperação e exclusão. O catálogo de anexos também consulta só metadados públicos necessários à tela.

`getSmartImportStatus` já possuía uma projeção reduzida: foi preservada, inclusive registros removidos, necessários para reconciliar uma fila antiga. Não foram adicionados cache de resultados nem truncamento de itens. Permanecem quatro consultas no detalhe sem candidatos, cinco com candidatos e duas no estado de importação. Reduziu-se trabalho e volume por consulta, não a contagem de round trips.

O leitor acumula páginas separadamente e verifica o limite de texto antes de fazer o join de cada página. A limpeza da página ocorre também em caso de limite/erro. Isso limita alocações adicionais da aplicação, **não** impõe um limite de CPU ao parser nem impede que `getTextContent` aloque conteúdo antes de retornar. Não se tentou interromper CPU síncrona com um timeout de Promise.

Não foram alterados `worker.ts`, `vite.config.ts`, `db/index.ts`, crons, OAuth, quotas, migrações, fluxo de confirmação ou frontend. O protocolo e a fila do cliente permanecem iguais. Não foi introduzida infraestrutura assíncrona sem um executor definido.

## Medições reproduzíveis

Ferramentas instaladas no projeto: Node 24.21.0, Miniflare 4.20260515.0/workerd, esbuild, V8 Inspector via CDP (`Profiler.start/stop`, intervalo solicitado de 100 µs). Perfis `.cpuprofile` abrem no Chrome/Edge DevTools. As execuções finais de baseline e otimização foram sequenciais, após encerrar os testes/build concorrentes.

O profiler compila as funções reais da rota/consulta/contrato e o leitor real com condições de Workers. PostgreSQL e autenticação da rota são simulados, e `NextResponse` é substituído por `Response.json`. O segmento PDF mede leitura dos bytes, hash, parser e reconhecimento de CNPJ, **não o POST completo com reserva/storage/commit**. Uma medição separada executa `jose.jwtVerify` real com chave RS256 sintética já carregada. Nenhuma chamada externa é permitida.

O campo `sampledActiveMsPerRequest` soma os intervalos atribuídos a frames ativos, excluindo `(idle)`, `(program)` e `(root)`. É uma estimativa de amostragem do runtime V8 local, sujeita a pausas do sistema, overhead do inspector e atribuição imprecisa de intervalos. **Não é a métrica de CPU faturada da Cloudflare**, não inclui todos os custos nativos, nem constitui um teste do limite de produção. `wallMsPerRequest` vem do relógio do processo controlador e inclui espera/transporte local. Não se usou `Date.now` dentro do Worker como medidor de CPU.

Resultado da execução final (ms por requisição do harness):

| Cenário | Amostras ativas antes | Depois | Tempo decorrido antes | Depois |
|---|---:|---:|---:|---:|
| GET vazio, 30 repetições | 4,39 | 3,91 | 4,56 | 4,92 |
| GET 30 documentos, 30 repetições | 5,19 | 5,05 | 5,46 | 5,90 |
| GET 100 documentos, 30 repetições | 7,92 | 9,15 | 9,53 | 9,50 |
| Import-status 100 documentos, 30 repetições | 2,85 | 3,33 | 4,07 | 4,54 |
| PDF pequeno, primeira leitura do parser | 95,46 | 107,13 | 97,99 | 109,93 |
| PDF pequeno, 10 leituras seguintes | 6,61 | 7,67 | 7,15 | 8,70 |
| PDF 50 páginas, 3 repetições | 34,56 | 49,08 | 37,06 | 54,55 |
| PDF complexo comprimido, 3 repetições | 179,26 | 213,25 | 181,24 | 216,40 |
| PDF corrompido, 3 repetições | 2,85 | 3,57 | 6,16 | 5,55 |
| JWT RS256, chave carregada, 30 repetições | 2,63 | 3,03 | 3,26 | 3,69 |
| SHA-256 4 MiB, 10 repetições | 28,73 | 43,14 | 29,20 | 43,66 |

O PDF pequeno tem 614 bytes; o de 50 páginas, 15.214 bytes; o complexo tem 10 páginas, 300 operações por página, streams Flate e apenas 10.834 bytes. Fontes/transformações e operações de texto aparecem no perfil complexo; inicialização de módulos aparece na primeira leitura.

Não há ganho confiável de CPU total demonstrado pelos GETs ou PDFs. Até operações não modificadas (JWT/hash) variaram entre execuções. O mock de projeção também acrescenta cópias de objetos que não representam o transporte PostgreSQL real. Não se atribuem essas diferenças integralmente ao patch e não se promete resolução do 1102 com esses números.

A microcarga isolada de normalização executa 100 normalizações de detalhe com 100 itens por requisição, dez vezes. Amostras ativas passaram de **149,55 para 8,32 ms** por requisição da microcarga (~94% menos nesse cenário); tempo decorrido de 151,24 para 9,07 ms. Isso comprova redução no componente, não na requisição de produção inteira.

`Runtime.getHeapUsage` registra snapshots, sem forçar GC. Após o PDF complexo, o heap usado observado foi ~14,1 MB antes e ~18,2 MB depois; a microcarga artificial de normalização chegou a ~159 MB antes e ~6,4 MB depois. Esses snapshots dependem do GC e acumulam trabalho anterior. Não são pico, RSS nem prova de conformidade com memória de produção; workerd local não reproduz automaticamente os limites comerciais.

### Build efetivo do Worker

Foi executado `node scripts/run-framework.mjs build` antes e depois. `inspect-smart-bundle.mjs` percorre imports estáticos transitivos do chunk da API gerado pelo Vite; não usa apenas o grafo TypeScript como evidência.

- Dependências estáticas da rota: **282.072 → 261.992 bytes**, redução de 20.080 bytes (~7,1%), sem compressão.
- Antes: serviço de mutações, wrapper PDF e Gmail no grafo estático; PDF.js de 1.601.924 bytes em import dinâmico.
- Depois: serviço de mutações dinâmico; leitor PDF em chunk separado de 2.212 bytes; PDF.js continua dinâmico, com 1.601.924 bytes.
- Esses tamanhos não são tempo de inicialização nem tamanho total do Worker. Framework e outros endpoints continuam existindo. O build emite o aviso de chunks grandes do cliente; não é o erro 1102.

### Comandos

```powershell
node scripts/profile-smart-cpu.mjs baseline 896820cb5b27106628208237e621b2638b1403a3
node scripts/profile-smart-cpu.mjs optimized
node scripts/run-framework.mjs build
node scripts/inspect-smart-bundle.mjs optimized
```

O hash opcional carrega pelo `git show` os arquivos relevantes da revisão antiga, sem trocar o checkout. O grafo do build antigo foi capturado antes de recompilar; para reproduzir esse grafo depois, use outro checkout da revisão antiga e faça seu build local.

Artefatos desta execução, ignorados pelo Git: `outputs/smart-cpu/baseline-final/`, `optimized-final/`, `before/bundle.json`, `after/bundle.json`, `tests.txt`. Os scripts são versionáveis; perfis só contêm código/fixtures sintéticas, nunca PDFs reais, credenciais ou tokens. Não carregue dumps de documentos de produção no profiler.

## Preservação e testes

As reservas por UUID/hash, locks por proprietário/conteúdo, leases de importação e atualização condicional de `updatedAt` continuam no serviço. O armazenamento permanece privado e o hash é conferido na recuperação e na visualização. Uma análise interrompida continua pendente/recuperável; não se marca como concluída por ter salvo o arquivo. A recuperação reutiliza o registro e o objeto existente, sem reenvio Gmail implícito. As consultas de envio/exclusão continuam usando os dados completos e suas barreiras originais.

Cobertura executada em banco PGlite descartável, mocks de storage/Gmail e runtime workerd local:

- GET real da rota com 0, 30 e 100 documentos; contrato, contagens, prévia preservada, metadados internos ausentes e consulta durante `UPLOADING`. O teste faz falhar qualquer carregamento do serviço de mutações/parser durante esses GETs.
- Upload real do serviço de PDF pequeno; lotes sequenciais de 26 e 100 PDFs sintéticos, sem envio automático; progresso e reconciliação.
- Workerd: texto válido, 50 páginas, PDF comprimido complexo, limite de páginas, limite de texto e PDF corrompido. Node: proteção por senha e associação manual/CNPJ.
- Timeout antes/depois do storage, resposta perdida, lease ativo/expirado, estado de Worker interrompido, recuperação no mesmo ID e rejeição de hash alterado. A interrupção de processo é representada por estados persistidos e falhas injetadas; não se provocou um 1102 remoto.
- Retomada de fila, seleção repetida, múltiplas importações, exclusão controlada, falha/repetição de DELETE, referências históricas, isolamento por proprietário.
- Contratos rejeitam IDs inválidos em cada campo; mantêm UUID, booleanos e corpos de mensagem sem conversão. JWT e CSRF seguem verificados.
- Regressões de campanhas tradicionais, quotas compartilhadas, barreira Gmail, resultados `UNCERTAIN`, agendamento e exclusão de lotes.

Comando consolidado:

```powershell
node --test --test-concurrency=2 scripts/test-smart-foundation.mjs scripts/test-smart-security.mjs scripts/test-smart-import-contract.mjs scripts/test-smart-sends.mjs scripts/test-smart-import.mjs scripts/test-smart-batch-management.mjs scripts/test-campaign-runner.mjs scripts/test-smart-worker.mjs scripts/test-worker-cron.mjs
node node_modules/typescript/bin/tsc --noEmit
```

**Resultado: 173 testes aprovados, zero falhas.** TypeScript sem erros, lint dos arquivos alterados sem avisos/erros e build de produção local concluído. Resultados finais estão em `outputs/smart-cpu/tests.txt`. Não foi executado navegador contra homologação/produção; compatibilidade da interface foi verificada pelos campos usados no componente e por contratos/testes da rota.

## Infraestrutura recomendada

O Workers Free documenta **10 ms de CPU por invocação HTTP**. O plano Standard/Paid tem assinatura base de **US$ 5/mês**, inclui 10 milhões de requisições e 30 milhões de ms de CPU/mês; excedentes de US$ 0,30/milhão de requisições e US$ 0,02/milhão de ms. O limite padrão de CPU por invocação é 30 segundos, configurável até cinco minutos. Valores consultados para esta auditoria, antes de impostos/câmbio e outros serviços. [Preços oficiais](https://developers.cloudflare.com/workers/platform/pricing/).

**Recomendação de menor mudança:** confirmar primeiro o plano real. Se for Free, avaliar Paid em homologação, mantendo o armazenamento Supabase existente e os limites atuais de arquivo/páginas. Os perfis não permitem garantir PDFs arbitrários em 10 ms, inclusive por inicialização, hash e estruturas comprimidas. Não basta tornar o parser lazy ou mover a mesma função para cron gratuito. Se já for Paid, investigar os perfis reais e a complexidade dos documentos antes de alterar qualquer limite.

Não foi configurado `cpu_ms`, comprado plano ou implantado serviço. Também não se afirmou que 30 segundos resolvem qualquer PDF: documentos adversos podem exceder CPU/memória mesmo no plano pago.

Alternativa para processamento assíncrono, a projetar após escolher um executor com orçamento suficiente:

1. API autentica, valida MIME/assinatura/tamanho e hash, reserva ID e salva no bucket privado.
2. Job persistente por documento passa por `STORED → ANALYSIS_PENDING → ANALYZING → ANALYZED` ou falha explícita; lease, tentativas limitadas e fencing protegem resultados tardios.
3. Executor confiável (Worker Paid separado ou processo Node/container já disponível) relê bytes privados, confere SHA-256, extrai texto e reconhece CNPJs dentro de limites de CPU/memória impostos pelo executor.
4. Persistência atômica do resultado por proprietário/ID/hash; redelivery é idempotente. Recuperação encontra o job após interrupção. Confirmação manual e envio permanecem separados.

Worker Paid separado facilita isolamento, mas uma chamada HTTP a ele ainda exige tratar timeout e persistência. Fila/consumidor adicionam custo e configuração próprios, a orçar antes de implementar. Usar um servidor existente pode evitar nova assinatura, mas consome sua capacidade e exige operação, isolamento, credenciais restritas e monitoramento; não é custo zero garantido. Um serviço serverless adicional exigiria prova com os PDFs e verificação de suas quotas antes de escolha.

Parsing no navegador pode auxiliar sugestões, mas um resultado fornecido pelo cliente não substitui integridade/análise confiável para autorizar o envio. Não foi adotado como atalho. Sem recursos suficientes no servidor, permanecer exclusivamente no Free não permite prometer o processamento completo solicitado.

## Validação em Cloudflare, sem deploy automático

1. Identificar Worker, versão, plano, compatibilidade e limite efetivo da configuração que apresentou 1102. Preservar observabilidade existente e coletar apenas status/outcome, CPU, duração, versão e classe/tamanho do cenário; nunca conteúdo, token, destinatário ou credencial.
2. Preparar homologação isolada com bucket privado, banco e proprietário de teste, Cloudflare Access real e Gmail de teste sem disparar envios. Publicação é uma ação separada; esta auditoria não a executou.
3. No painel Workers & Pages, usar métricas/logs de invocação para CPU e duração separadamente. Registrar resultados frios/quentes, mediana, p95, máximo, erros e tamanho de resposta para GET vazio/30/100, import-status e uploads pequeno/multipágina/complexo. Obter perfis de CPU da versão em teste quando o recurso estiver disponível no plano. [Profiling oficial](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/), [métricas](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).
4. Repetir os lotes de 26/100, consultas durante upload e importações sequenciais. Capturar heap/pico de memória com ferramenta apropriada; snapshots locais deste relatório não substituem esse teste.
5. Interromper a conexão/execução em pontos controlados: depois da reserva, após o PUT e durante a análise. Reconciliar e recuperar com mesmo ID/hash após lease expirado. Verificar contagem de registros/objetos, bloqueio de envio antes da confirmação e preservação de históricos/duplicatas.
6. Validar associação manual, prévia por documento, CSV, exclusão elegível/bloqueada e filas tradicionais. Não confirmar início de Gmail durante o ensaio de importação.
7. Aceitar a correção operacional somente com CPU máxima abaixo do limite efetivo com margem, ausência de 1102 na matriz representativa e invariantes de recuperação comprovadas. Se o plano Free não comportar o ensaio, escolher infraestrutura antes de publicar. Reverter a versão de aplicação se necessário; este patch não exige migração nem remoção de registros.
