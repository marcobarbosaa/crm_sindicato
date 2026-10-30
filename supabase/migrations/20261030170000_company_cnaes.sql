-- Additive CNAE structure. Apply before deploying CNAE code.
-- Leaves the legacy "segment" column and all existing companies untouched.
begin;
set local lock_timeout = '5s';

alter table public.companies
  add column if not exists cnae_primary_code text,
  add column if not exists cnae_primary_description text,
  add column if not exists cnae_secondaries jsonb not null default '[]'::jsonb,
  add column if not exists cnae_source text,
  add column if not exists cnae_reference text,
  add column if not exists cnae_synced_at bigint;

create index if not exists idx_companies_owner_cnae_primary
  on public.companies (owner_id, cnae_primary_code);
create index if not exists idx_companies_cnae_secondaries_gin
  on public.companies using gin (cnae_secondaries jsonb_path_ops);

commit;
