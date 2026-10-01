import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { emailMessages } from "@/db/schema";

// Reserve daily capacity for sends whose external result is not yet known.
export function dailyCampaignUsage(ownerId: string, start: Date, next: Date) {
  return and(eq(emailMessages.ownerId, ownerId), or(
    and(eq(emailMessages.status, "SENT"), gte(emailMessages.sentAt, sql`${start.getTime()}`), lte(emailMessages.sentAt, sql`${next.getTime() - 1}`)),
    and(inArray(emailMessages.status, ["SENDING", "UNCERTAIN", "QUEUED"]), gte(emailMessages.createdAt, sql`${start.getTime()}`), lte(emailMessages.createdAt, sql`${next.getTime() - 1}`)),
  ));
}
