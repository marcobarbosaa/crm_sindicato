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
