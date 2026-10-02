-- Extend the message lifecycle required by the campaign send barrier.
-- Does not change campaign state, recipient attempts or existing messages.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.email_messages
  DROP CONSTRAINT IF EXISTS email_messages_status_check;
ALTER TABLE public.email_messages
  ADD CONSTRAINT email_messages_status_check
  CHECK (status IN ('QUEUED', 'PREPARED', 'SENDING', 'RETRYABLE', 'UNCERTAIN', 'SENT', 'FAILED'));
COMMIT;
