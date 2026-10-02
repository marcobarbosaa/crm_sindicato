ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS needs_reconnect boolean NOT NULL DEFAULT false;
