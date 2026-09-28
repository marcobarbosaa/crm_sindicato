-- Infraestrutura de campanhas de e-mail em lote.
-- Idempotente para permitir aplicação segura em ambientes que já possuam parte da estrutura.

CREATE TABLE IF NOT EXISTS "email_campaigns" (
  "id" serial PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "name" text NOT NULL,
  "template_id" integer,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "pending" integer DEFAULT 0 NOT NULL,
  "sent" integer DEFAULT 0 NOT NULL,
  "failed" integer DEFAULT 0 NOT NULL,
  "skipped" integer DEFAULT 0 NOT NULL,
  "batch_size" integer DEFAULT 25 NOT NULL,
  "interval_minutes" integer DEFAULT 10 NOT NULL,
  "next_run_at" bigint,
  "lock_until" bigint,
  "started_at" bigint,
  "completed_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);
ALTER TABLE "email_campaigns" ADD COLUMN IF NOT EXISTS "next_run_at" bigint;
ALTER TABLE "email_campaigns" ADD COLUMN IF NOT EXISTS "lock_until" bigint;
DO $$ BEGIN ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "idx_email_campaigns_owner_created" ON "email_campaigns" USING btree ("owner_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_email_campaigns_owner_status" ON "email_campaigns" USING btree ("owner_id","status");
CREATE INDEX IF NOT EXISTS "idx_email_campaigns_due" ON "email_campaigns" USING btree ("status","next_run_at");

CREATE TABLE IF NOT EXISTS "email_campaign_recipients" (
  "id" serial PRIMARY KEY NOT NULL,
  "campaign_id" integer NOT NULL,
  "company_id" integer,
  "contact_id" integer,
  "recipient" text NOT NULL,
  "company_name" text NOT NULL,
  "personalization" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "processing_started_at" bigint,
  "message_id" integer,
  "error_message" text,
  "provider_message_id" text,
  "sent_at" bigint,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);
ALTER TABLE "email_campaign_recipients" ADD COLUMN IF NOT EXISTS "processing_started_at" bigint;
ALTER TABLE "email_campaign_recipients" ADD COLUMN IF NOT EXISTS "message_id" integer;
DO $$ BEGIN ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE INDEX IF NOT EXISTS "idx_campaign_recipients_campaign_status" ON "email_campaign_recipients" USING btree ("campaign_id","status");
CREATE INDEX IF NOT EXISTS "idx_campaign_recipients_processing" ON "email_campaign_recipients" USING btree ("status","processing_started_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_campaign_recipient_company" ON "email_campaign_recipients" USING btree ("campaign_id","company_id");

ALTER TABLE "email_messages" ADD COLUMN IF NOT EXISTS "campaign_id" integer;
DO $$ BEGIN ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
