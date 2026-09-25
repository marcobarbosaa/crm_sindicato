-- Additive migration; run before deploying the new application.
begin;
create table if not exists public.template_attachments (
  id text primary key,
  owner_id text not null,
  template_id bigint references public.email_templates(id) on delete set null,
  name text not null,
  mime_type text not null,
  size integer not null check (size > 0),
  storage_key text not null unique,
  ready boolean not null default false,
  created_at bigint not null,
  expires_at bigint not null
);
create index if not exists idx_template_attachments_owner_template on public.template_attachments(owner_id, template_id);
create index if not exists idx_template_attachments_expiry on public.template_attachments(expires_at) where template_id is null;
alter table public.template_attachments enable row level security;
alter table public.email_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
commit;
