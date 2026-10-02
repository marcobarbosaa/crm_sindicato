import { sql } from "drizzle-orm";
import { companies, contacts } from "@/db/schema";

// One deterministic primary contact, shared by preview and preparation.
export const primaryContactId = sql<number>`(select c.id from contacts c where c.company_id = ${companies.id}
  and c.is_primary = true and nullif(btrim(c.email), '') is not null order by c.id limit 1)`;
export const audienceRecipient = sql<string | null>`coalesce(nullif(lower(btrim(${contacts.email})), ''), nullif(lower(btrim(${companies.primaryEmail})), ''))`;
// A different primary contact remains eligible: the invalidity belongs to the
// company's specific primary address, not to all addresses of that company.
export const audienceKnownInvalid = sql<boolean>`(${companies.primaryEmailStatus} = 'INVALID' and ${audienceRecipient} = lower(btrim(${companies.primaryEmail})))`;
