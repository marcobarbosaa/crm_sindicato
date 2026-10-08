import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

const timestampMs = customType<{ data: Date; driverData: number }>({
  dataType: () => "bigint",
  toDriver: (value) => value.getTime(),
  fromDriver: (value) => new Date(Number(value)),
});

export const documentSendBatches = pgTable('document_send_batches', {
  id: serial('id').primaryKey(), ownerId: text('owner_id').notNull(), name: text('name').notNull(),
  status: text('status').notNull().default('DRAFT'), revision: integer('revision').notNull().default(0),
  templateId: integer('template_id').references(() => emailTemplates.id, { onDelete: 'set null' }), templateName: text('template_name'), senderAddress: text('sender_address'), accountId: integer('account_id').references(() => emailAccounts.id, { onDelete: 'set null' }),
  commonAttachments: jsonb('common_attachments').$type<import('../lib/attachments').Attachment[]>().notNull().default([]),
  intervalSeconds: integer('interval_seconds').notNull().default(60), nextRunAt: timestampMs('next_run_at'),
  lockToken: text('lock_token'), lockUntil: timestampMs('lock_until'), notice: text('notice'),
  confirmedAt: timestampMs('confirmed_at'), completedAt: timestampMs('completed_at'),
  createdAt: timestampMs('created_at').notNull(), updatedAt: timestampMs('updated_at').notNull(),
}, t => [index('idx_document_batches_due').on(t.status, t.nextRunAt), index('idx_document_batches_owner').on(t.ownerId, t.createdAt)]);
export const documentSendItems = pgTable('document_send_items', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), batchId: integer('batch_id').notNull().references(() => documentSendBatches.id),
  fileName: text('file_name').notNull(), fileSize: integer('file_size').notNull(), contentHash: text('content_hash').notNull(), storageKey: text('storage_key').notNull().unique(),
  fileReady: boolean('file_ready').notNull().default(false), readable: boolean('readable').notNull().default(false), removedAt: timestampMs('removed_at'), fileDeletedAt: timestampMs('file_deleted_at'),
  duplicateOf: text('duplicate_of'), companyId: integer('company_id').references(() => companies.id, { onDelete: 'set null' }), companyName: text('company_name'), companyCnpj: text('company_cnpj'), recipient: text('recipient'),
  extractedCnpjs: jsonb('extracted_cnpjs').$type<string[]>().notNull().default([]), candidates: jsonb('candidates').$type<number[]>().notNull().default([]),
  identificationMethod: text('identification_method').notNull().default('MANUAL'), reviewStatus: text('review_status').notNull().default('UPLOADING'),
  confirmedAt: timestampMs('confirmed_at'), excluded: boolean('excluded').notNull().default(false),
  subject: text('subject'), body: text('body'), sendStatus: text('send_status').notNull().default('DRAFT'), attempts: integer('attempts').notNull().default(0), infrastructureAttempts: integer('infrastructure_attempts').notNull().default(0),
  messageId: integer('message_id'), rfcMessageId: text('rfc_message_id').notNull().unique(), providerMessageId: text('provider_message_id'),
  processingAt: timestampMs('processing_at'), sentAt: timestampMs('sent_at'), error: text('error'),
  deliveryStatus: text('delivery_status').notNull().default('PENDING'), deliveryError: text('delivery_error'), bounceMessageId: text('bounce_message_id'),
  deliveryCheckedAt: timestampMs('delivery_checked_at'), deliveryNextAt: timestampMs('delivery_next_at'), deliveryPageToken: text('delivery_page_token'), deliveryBefore: timestampMs('delivery_before'), deliveryIncomplete: boolean('delivery_incomplete').notNull().default(false),
  deliveryLockToken: text('delivery_lock_token'), deliveryLockUntil: timestampMs('delivery_lock_until'),
  createdAt: timestampMs('created_at').notNull(), updatedAt: timestampMs('updated_at').notNull(),
}, t => [index('idx_document_items_batch').on(t.ownerId, t.batchId), index('idx_document_items_hash').on(t.ownerId, t.contentHash), index('idx_document_items_delivery').on(t.sendStatus, t.deliveryNextAt)]);
export const documentSendDeliveryEvents = pgTable('document_send_delivery_events', {
  id: serial('id').primaryKey(), itemId: text('item_id').notNull().references(() => documentSendItems.id), ownerId: text('owner_id').notNull(),
  gmailMessageId: text('gmail_message_id').notNull(), status: text('status').notNull(), category: text('category').notNull(), diagnostic: text('diagnostic'), createdAt: timestampMs('created_at').notNull(),
}, t => [uniqueIndex('uq_smart_delivery_event').on(t.itemId, t.gmailMessageId)]);

export const companies = pgTable("companies", { id: serial("id").primaryKey(), ownerId: text("owner_id").notNull(), name: text("name").notNull(), tradeName: text("trade_name"), cnpj: text("cnpj"), website: text("website"), segment: text("segment"), region: integer("region"), city: text("city"), state: text("state"), address: text("address"), phone: text("phone"), phoneWhatsAppStatus: text("phone_whatsapp_status").notNull().default("UNKNOWN"), mobile: text("mobile"), mobileWhatsAppStatus: text("mobile_whatsapp_status").notNull().default("UNKNOWN"), primaryEmail: text("primary_email"), primaryEmailStatus: text("primary_email_status").notNull().default("UNKNOWN"), primaryEmailStatusReason: text("primary_email_status_reason"), primaryEmailStatusUpdatedAt: timestampMs("primary_email_status_updated_at"), employeeCount: integer("employee_count"), employeeRange: text("employee_range"), companySize: text("company_size"), notes: text("notes"), status: text("status").notNull().default("NOT_CONTACTED"), lastContactAt: timestampMs("last_contact_at"), nextFollowUpAt: timestampMs("next_follow_up_at"), createdAt: timestampMs("created_at").notNull(), updatedAt: timestampMs("updated_at").notNull() }, table => [index("idx_companies_owner_status").on(table.ownerId, table.status), index("idx_companies_owner_region_city").on(table.ownerId, table.region, table.city), index("idx_companies_owner_email").on(table.ownerId, table.primaryEmail), index("idx_companies_owner_email_status").on(table.ownerId, table.primaryEmailStatus), uniqueIndex("uq_companies_owner_cnpj").on(table.ownerId, table.cnpj)]);
export const contacts = pgTable("contacts", { id: serial("id").primaryKey(), companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), name: text("name"), email: text("email"), phone: text("phone"), role: text("role"), isPrimary: boolean("is_primary").notNull().default(false), createdAt: timestampMs("created_at").notNull() });
export const emailTemplates = pgTable("email_templates", { id: serial("id").primaryKey(), ownerId: text("owner_id").notNull(), name: text("name").notNull(), subject: text("subject").notNull(), body: text("body").notNull(), createdAt: timestampMs("created_at").notNull(), updatedAt: timestampMs("updated_at").notNull() });

export type LogicalCampaignBatch = { id: string; recipientIds: number[]; startedAt: number };
export const campaignOwnerLeases = pgTable("campaign_owner_leases", {
  ownerId: text("owner_id").primaryKey(), token: text("token").notNull(),
  expiresAt: timestampMs("expires_at").notNull(),
});

export const emailCampaigns = pgTable("email_campaigns", {
  deliveryMonitoringEnabled: boolean("delivery_monitoring_enabled").notNull().default(true),
  deliveryNextCheckAt: timestampMs("delivery_next_check_at"),
  deliveryCheckedAt: timestampMs("delivery_checked_at"),
  deliveryCompletedAt: timestampMs("delivery_completed_at"),
  audienceWithoutEmail: integer("audience_without_email").notNull().default(0),
  audienceInvalidEmail: integer("audience_invalid_email").notNull().default(0),
  logicalBatch: jsonb("logical_batch").$type<LogicalCampaignBatch>(),
  processingNotice: text("processing_notice"),
  id: serial("id").primaryKey(), ownerId: text("owner_id").notNull(), name: text("name").notNull(), templateId: integer("template_id").references(() => emailTemplates.id, { onDelete: "set null" }), status: text("status").notNull().default("DRAFT"), audience: jsonb("audience").$type<{ region?: number; city?: string; companySize?: string; companyStatus?: string; groupIds?: number[] }>().notNull().default({}), total: integer("total").notNull().default(0), pending: integer("pending").notNull().default(0), sent: integer("sent").notNull().default(0), failed: integer("failed").notNull().default(0), skipped: integer("skipped").notNull().default(0), batchSize: integer("batch_size").notNull().default(25), intervalMinutes: integer("interval_minutes").notNull().default(10), nextRunAt: timestampMs("next_run_at"), lockUntil: timestampMs("lock_until"), startedAt: timestampMs("started_at"), completedAt: timestampMs("completed_at"), createdAt: timestampMs("created_at").notNull(), updatedAt: timestampMs("updated_at").notNull()
}, table => [index("idx_email_campaigns_owner_created").on(table.ownerId, table.createdAt), index("idx_email_campaigns_owner_status").on(table.ownerId, table.status), index("idx_email_campaigns_due").on(table.status, table.nextRunAt), index("idx_campaign_delivery_due").on(table.deliveryNextCheckAt, table.completedAt).where(sql`${table.deliveryMonitoringEnabled} and ${table.deliveryCompletedAt} is null and ${table.status} = 'COMPLETED'`)]);

export const emailCampaignRecipients = pgTable("email_campaign_recipients", {
  deliveryStatus: text("delivery_status").notNull().default("PENDING"),
  deliveryFailureCategory: text("delivery_failure_category"),
  deliveryDiagnosticCode: text("delivery_diagnostic_code"),
  deliveryErrorMessage: text("delivery_error_message"),
  bouncedAt: timestampMs("bounced_at"),
  bounceMessageId: text("bounce_message_id"),
  deliveryCheckedAt: timestampMs("delivery_checked_at"),
  lastBatchId: text("last_batch_id"),
  failureCategory: text("failure_category"),
  id: serial("id").primaryKey(), campaignId: integer("campaign_id").notNull().references(() => emailCampaigns.id, { onDelete: "cascade" }), companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }), contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }), recipient: text("recipient").notNull(), companyName: text("company_name").notNull(), personalization: jsonb("personalization").$type<Record<string,string>>().notNull().default({}), status: text("status").notNull().default("PENDING"), attempts: integer("attempts").notNull().default(0), processingStartedAt: timestampMs("processing_started_at"), messageId: integer("message_id"), errorMessage: text("error_message"), providerMessageId: text("provider_message_id"), sentAt: timestampMs("sent_at"), createdAt: timestampMs("created_at").notNull(), updatedAt: timestampMs("updated_at").notNull()
}, table => [index("idx_campaign_recipients_campaign_status").on(table.campaignId, table.status), index("idx_campaign_recipient_recovery").on(table.campaignId, table.status, table.processingStartedAt), index("idx_campaign_recipients_processing").on(table.status, table.processingStartedAt), uniqueIndex("uq_campaign_recipient_company").on(table.campaignId, table.companyId)]);

export const emailMessages = pgTable("email_messages", { rfcMessageId: text("rfc_message_id"), emailAccountId: integer("email_account_id"), senderAddress: text("sender_address"), id: serial("id").primaryKey(), ownerId: text("owner_id").notNull(), companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }), contactId: integer("contact_id").references(() => contacts.id, { onDelete: "set null" }), templateId: integer("template_id").references(() => emailTemplates.id, { onDelete: "set null" }), campaignId: integer("campaign_id").references(() => emailCampaigns.id, { onDelete: "set null" }), recipient: text("recipient").notNull(), subject: text("subject").notNull(), body: text("body").notNull(), status: text("status").notNull().default("QUEUED"), kind: text("kind").notNull().default("INDIVIDUAL"), attachments: jsonb("attachments").$type<import("../lib/attachments").Attachment[]>().notNull().default([]), providerMessageId: text("provider_message_id"), errorMessage: text("error_message"), sentAt: timestampMs("sent_at"), createdAt: timestampMs("created_at").notNull() }, table => [index("idx_delivery_message_reference").on(table.ownerId, table.rfcMessageId), index("idx_delivery_message_recipient").on(table.ownerId, sql`lower(btrim(${table.recipient}))`, table.sentAt)]);
export const activityLogs = pgTable("activity_logs", { id: serial("id").primaryKey(), ownerId: text("owner_id").notNull(), companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }), type: text("type").notNull(), description: text("description").notNull(), createdAt: timestampMs("created_at").notNull() }, table => [index("idx_activity_owner_created").on(table.ownerId, table.createdAt)]);
export const followUps = pgTable("follow_ups", { id: serial("id").primaryKey(), ownerId: text("owner_id").notNull(), companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), dueAt: timestampMs("due_at").notNull(), status: text("status").notNull().default("PENDING"), note: text("note"), createdAt: timestampMs("created_at").notNull() }, table => [index("idx_followups_owner_due").on(table.ownerId, table.dueAt)]);
export const importBatches = pgTable("import_batches", { id: serial("id").primaryKey(), ownerId: text("owner_id").notNull(), fileName: text("file_name").notNull(), totalRows: integer("total_rows").notNull(), importedRows: integer("imported_rows").notNull(), updatedRows: integer("updated_rows").notNull().default(0), skippedRows: integer("skipped_rows").notNull().default(0), errorRows: integer("error_rows").notNull().default(0), createdAt: timestampMs("created_at").notNull() }, table => [index("idx_import_batches_owner_created").on(table.ownerId, table.createdAt)]);
export const emailAccounts = pgTable("email_accounts", { needsReconnect: boolean("needs_reconnect").notNull().default(false), id: serial("id").primaryKey(), ownerId: text("owner_id").notNull(), provider: text("provider").notNull().default("GMAIL"), email: text("email").notNull(), encryptedRefreshToken: text("encrypted_refresh_token").notNull(), scopes: text("scopes").notNull().default(""), connectedAt: timestampMs("connected_at").notNull(), updatedAt: timestampMs("updated_at").notNull() }, table => [uniqueIndex("uq_email_accounts_owner_provider").on(table.ownerId, table.provider)]);
export const oauthStates = pgTable("oauth_states", { state: text("state").primaryKey(), ownerId: text("owner_id").notNull(), expiresAt: timestampMs("expires_at").notNull(), createdAt: timestampMs("created_at").notNull() }, table => [index("idx_oauth_states_expires").on(table.expiresAt)]);
export const crmSettings = pgTable("crm_settings", { ownerId: text("owner_id").primaryKey(), senderName: text("sender_name").notNull().default(""), signature: text("signature").notNull().default(""), dailySendLimit: integer("daily_send_limit").notNull().default(100), timezone: text("timezone").notNull().default("America/Sao_Paulo"), updatedAt: timestampMs("updated_at").notNull() });
export const templateAttachments = pgTable("template_attachments", { id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), templateId: integer("template_id").references(() => emailTemplates.id, { onDelete: "set null" }), name: text("name").notNull(), mimeType: text("mime_type").notNull(), size: integer("size").notNull(), storageKey: text("storage_key").notNull().unique(), ready: boolean("ready").notNull().default(false), createdAt: timestampMs("created_at").notNull(), expiresAt: timestampMs("expires_at").notNull() }, table => [index("idx_template_attachments_owner_template").on(table.ownerId, table.templateId), index("idx_template_attachments_expiry").on(table.expiresAt)]);

export const emailDeliveryEvents = pgTable("email_delivery_events", {
  id: serial("id").primaryKey(), ownerId: text("owner_id").notNull(),
  campaignId: integer("campaign_id").notNull().references(() => emailCampaigns.id, { onDelete: "cascade" }),
  campaignRecipientId: integer("campaign_recipient_id").notNull().references(() => emailCampaignRecipients.id, { onDelete: "cascade" }),
  emailMessageId: integer("email_message_id").notNull().references(() => emailMessages.id, { onDelete: "cascade" }),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
  recipient: text("recipient").notNull(), gmailMessageId: text("gmail_message_id").notNull(), gmailThreadId: text("gmail_thread_id"),
  eventType: text("event_type").notNull(), category: text("category").notNull(), smtpStatus: text("smtp_status"), diagnostic: text("diagnostic"),
  detectedAt: timestampMs("detected_at").notNull(), createdAt: timestampMs("created_at").notNull(),
}, table => [uniqueIndex("uq_delivery_event_message_recipient").on(table.ownerId, table.gmailMessageId, table.recipient), index("idx_delivery_events_campaign").on(table.ownerId, table.campaignId)]);
export const gmailDeliverySyncState = pgTable("gmail_delivery_sync_state", {
  campaignId: integer("campaign_id").primaryKey().references(() => emailCampaigns.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(), emailAccountId: integer("email_account_id").notNull().references(() => emailAccounts.id, { onDelete: "cascade" }),
  accountConnectedAt: timestampMs("account_connected_at").notNull(),
  lastCheckedAt: timestampMs("last_checked_at"), scanAfter: timestampMs("scan_after"), scanBefore: timestampMs("scan_before"), pageToken: text("page_token"),
  lockToken: text("lock_token"), lockUntil: timestampMs("lock_until"), lastError: text("last_error"), incomplete: boolean("incomplete").notNull().default(false), updatedAt: timestampMs("updated_at").notNull(),
}, table => [index("idx_delivery_sync_owner_account").on(table.ownerId, table.emailAccountId)]);
