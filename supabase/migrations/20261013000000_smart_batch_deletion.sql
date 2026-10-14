begin;
set local lock_timeout = '5s';
alter table public.document_send_items add column import_active_at bigint;
alter table public.document_send_batches
  add column deletion_requested_at bigint,
  add column deleted_at bigint,
  add column deletion_error text;
alter table public.document_send_batches add constraint document_batch_deletion_state
  check ((deleted_at is null or deletion_requested_at is not null)
    and (deletion_requested_at is null or status = 'CANCELLED'));
create index idx_document_batches_deletion on public.document_send_batches(updated_at)
  where deletion_requested_at is not null and deleted_at is null;
create index idx_document_items_duplicate on public.document_send_items(duplicate_of)
  where duplicate_of is not null;
commit;
