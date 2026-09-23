import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    tradeName: text("trade_name"),
    cnpj: text("cnpj"),
    website: text("website"),
    segment: text("segment"),
    region: integer("region"),
    city: text("city"),
    state: text("state"),
    address: text("address"),
    phone: text("phone"),
    phoneWhatsAppStatus: text("phone_whatsapp_status")
      .notNull()
      .default("UNKNOWN"),
    mobile: text("mobile"),
    mobileWhatsAppStatus: text("mobile_whatsapp_status")
      .notNull()
      .default("UNKNOWN"),
    primaryEmail: text("primary_email"),
    employeeCount: integer("employee_count"),
    employeeRange: text("employee_range"),
    companySize: text("company_size"),
    notes: text("notes"),
    status: text("status").notNull().default("NOT_CONTACTED"),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_companies_owner_status").on(table.ownerId, table.status),
    index("idx_companies_owner_region_city").on(
      table.ownerId,
      table.region,
      table.city,
    ),
    index("idx_companies_owner_email").on(table.ownerId, table.primaryEmail),
    uniqueIndex("uq_companies_owner_cnpj").on(table.ownerId, table.cnpj),
  ],
);

export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  role: text("role"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const emailTemplates = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const emailMessages = pgTable("email_messages", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  companyId: integer("company_id").references(() => companies.id, {
    onDelete: "set null",
  }),
  contactId: integer("contact_id").references(() => contacts.id, {
    onDelete: "set null",
  }),
  templateId: integer("template_id").references(() => emailTemplates.id, {
    onDelete: "set null",
  }),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("QUEUED"),
  kind: text("kind").notNull().default("INDIVIDUAL"),
  providerMessageId: text("provider_message_id"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    companyId: integer("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_activity_owner_created").on(table.ownerId, table.createdAt),
  ],
);

export const followUps = pgTable(
  "follow_ups",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("PENDING"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("idx_followups_owner_due").on(table.ownerId, table.dueAt)],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    fileName: text("file_name").notNull(),
    totalRows: integer("total_rows").notNull(),
    importedRows: integer("imported_rows").notNull(),
    updatedRows: integer("updated_rows").notNull().default(0),
    skippedRows: integer("skipped_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_import_batches_owner_created").on(
      table.ownerId,
      table.createdAt,
    ),
  ],
);

export const emailAccounts = pgTable(
  "email_accounts",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    provider: text("provider").notNull().default("GMAIL"),
    email: text("email").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    scopes: text("scopes").notNull().default(""),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("uq_email_accounts_owner_provider").on(
      table.ownerId,
      table.provider,
    ),
  ],
);

export const oauthStates = pgTable(
  "oauth_states",
  {
    state: text("state").primaryKey(),
    ownerId: text("owner_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("idx_oauth_states_expires").on(table.expiresAt)],
);

export const crmSettings = pgTable("crm_settings", {
  ownerId: text("owner_id").primaryKey(),
  senderName: text("sender_name").notNull().default(""),
  signature: text("signature").notNull().default(""),
  dailySendLimit: integer("daily_send_limit").notNull().default(100),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
