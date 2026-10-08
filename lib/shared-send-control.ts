import { and, eq, lte } from 'drizzle-orm';
import { getDb } from '@/db';
import { campaignOwnerLeases } from '@/db/schema';
// Same lease used by the existing campaign runner. One owner has one Gmail account.
export async function acquireSendLease(ownerId: string) {
  const token = crypto.randomUUID(), expiresAt = new Date(Date.now() + 5 * 60_000);
  const [lease] = await getDb().insert(campaignOwnerLeases).values({ ownerId, token, expiresAt })
    .onConflictDoUpdate({ target: campaignOwnerLeases.ownerId, set: { token, expiresAt }, setWhere: lte(campaignOwnerLeases.expiresAt, new Date()) }).returning();
  return lease ? { token, expiresAt } : null;
}
export async function releaseSendLease(ownerId: string, token: string) {
  await getDb().delete(campaignOwnerLeases).where(and(eq(campaignOwnerLeases.ownerId, ownerId), eq(campaignOwnerLeases.token, token)));
}
