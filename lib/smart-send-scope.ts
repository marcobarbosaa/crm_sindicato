import { and, eq } from 'drizzle-orm';
import { documentSendBatches as batches, documentSendItems as items } from '@/db/schema';

export const ownedBatch = (owner: string, id: number) => and(eq(batches.ownerId, owner), eq(batches.id, id));
export const ownedItems = (owner: string, id: number) => and(eq(items.ownerId, owner), eq(items.batchId, id));
