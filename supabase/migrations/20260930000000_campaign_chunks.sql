-- Apply BEFORE the application deployment. Existing QUEUED messages remain ambiguous.
begin;
alter table public.email_campaigns add column if not exists logical_batch jsonb;
alter table public.email_campaigns add column if not exists processing_notice text;
alter table public.email_campaign_recipients add column if not exists last_batch_id text;
alter table public.email_campaign_recipients add column if not exists failure_category text;
create table if not exists public.campaign_owner_leases (
  owner_id text primary key,
  token text not null,
  expires_at bigint not null
);
alter table public.campaign_owner_leases enable row level security;
create index if not exists idx_campaign_recipient_recovery
  on public.email_campaign_recipients (campaign_id, status, processing_started_at);
commit;
