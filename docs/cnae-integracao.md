# CNAE no CRM — BrasilAPI + Dados Abertos da Receita Federal

A migração `20261030170000_company_cnaes.sql` **deve** ser revisada e aplicada
no Supabase antes de publicar esta branch. Ela é aditiva e preserva a coluna
legada `segment`, contatos, campanhas, status, endereço e região.

## Duas fontes, dois usos

- **BrasilAPI:** `POST /api/companies/:id/cnaes` (botão em Detalhes da
  empresa) faz uma consulta pontual com timeout e sem chave. Há reaproveitamento
  de resultados de menos de 24 h. Respostas incorretas/não encontradas não
  sobrescrevem os CNAEs existentes. Nunca usar para varrer a base inteira.
- **Receita Federal:** processamento offline dos arquivos públicos de uma
  mesma competência, usando somente os CNPJs presentes no CRM. Não há download
  massivo ou processamento de ZIPs dentro dos Cloudflare Workers.

Documentação oficial do layout:
https://www.gov.br/receitafederal/dados/cnpj-metadados.pdf

Arquivos oficiais: https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9

Baixar da mesma competência (AAAA-MM):
`Cnaes.zip` e **todos** os
`Estabelecimentos0.zip` ... `Estabelecimentos9.zip`.
Para CNAE não precisamos dos arquivos `Socios`, `Empresas` ou `Simples`.

## Procedimento offline (operador autorizado)

Ambiente: Node >= 22, Python >= 3.10, pacote `postgres` instalado e uma
conexão Postgres administrativa válida em `DATABASE_URL`. Preferir réplica
para exportar; para importação usar conexão restrita com somente UPDATE das
colunas de CNAE de `public.companies`. Execute em computador seguro.

1. Backup do banco e teste em homologação.
2. Após aplicar a migração, exporte **somente CNPJs**:

   ```bash
   node scripts/sync-receita-cnaes.mjs --owner local-preview-user --export-targets targets.csv
   ```

3. Extraia apenas os registros necessários, por streaming:

   ```bash
   python3 scripts/extract-receita-cnaes.py \
     --targets targets.csv \
     --estabelecimentos /caminho/receita/2026-10 \
     --cnaes /caminho/receita/2026-10/Cnaes.zip \
     --reference 2026-10 \
     --output cnaes.jsonl
   ```

4. Simule a aplicação, revise contagens e referência:

   ```bash
   node scripts/sync-receita-cnaes.mjs --owner local-preview-user --apply cnaes.jsonl
   ```

5. Somente após validar e aprovar a origem e o banco de destino:

   ```bash
   node scripts/sync-receita-cnaes.mjs --owner local-preview-user --apply cnaes.jsonl --confirm
   ```

O script **nunca cria empresas**; atualiza somente CNPJs/owner já existentes.
Não sobrescreve resultados já consultados via BrasilAPI. Registros ausentes,
sem CNAE válido ou com CNPJ inválido ficam pendentes; não inventar resultados.
Uma filial pode ter CNAEs diferentes da matriz: é indispensável usar o **CNPJ
completo** de 14 caracteres. O extrator lê ZIPs de forma sequencial e não
carrega todas as linhas em RAM; arquivos incompletos não devem ser utilizados.

## Segurança e operação

- Nunca anexar `DATABASE_URL`, `targets.csv`, `cnaes.jsonl`, ZIPs ou outros
  dumps ao Git. Após a operação, remover arquivos temporários conforme política.
- A consulta pela BrasilAPI não é automática em massa. Respeitar limites e
  termos de uso. A fonte oficial publica retratos periódicos, não tempo real.
- Conferir o campo `cnae_source` (`RECEITA` ou `BRASILAPI`), `cnae_reference`
  (competência da Receita) e `cnae_synced_at` no cadastro.
- A coluna antiga `segment` é preservada para compatibilidade com modelos de
  e-mail existentes que usam `{{segmento}}`. Não inferir CNAE de texto livre.
- O porte calculado pelo quadro de funcionários é uma classificação independente
  do porte cadastral da Receita e não é alterado.
- O CNAE não é, sozinho, critério suficiente para definir enquadramento sindical
  ou vigência de instrumento coletivo.

## Testes locais

Após instalar as dependências, execute `pnpm test:cnae` (Node e Python 3).
Isso exercita normalização, consulta BrasilAPI simulada e extração de ZIPs
sintéticos sem conexão com o banco ou serviço externo. Antes do deploy executar
também `pnpm lint` e `pnpm build` e validar a prévia de campanhas com CNAE
principal/segundário em ambiente de homologação. Nenhuma migração foi executada
automaticamente por esta mudança.

O sincronizador valida **todo o JSONL antes de iniciar os UPDATEs**. Cada
registro é gravado separadamente, portanto uma falha de banco após o início
da aplicação pode deixar atualização parcial; nesse caso, revise as contagens
e reexecute somente após investigar o problema. Nunca execute `--confirm`
sem backup e simulação.
