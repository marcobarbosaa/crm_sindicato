import { env } from "cloudflare:workers";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

import { AsyncLocalStorage } from "node:async_hooks";

const databaseScope = new AsyncLocalStorage<ReturnType<typeof createDb>>();
export function getDb() { return databaseScope.getStore() || createDb(); }

// TCP clients belong to one invocation, never to the global Worker scope.
export async function withCampaignDb<T>(work: () => Promise<T>): Promise<T> {
  if (databaseScope.getStore()) return work();
  const db = createDb(1);
  try { return await databaseScope.run(db, work); }
  finally { await db.$client.end({ timeout: 1 }).catch(() => {}); }
}

function createDb(max = 10) {
  const workerEnv = env as unknown as { DATABASE_URL?: string };
  const connectionString = workerEnv.DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is unavailable. Configure the Supabase PostgreSQL connection before using the database."
    );
  }

  return drizzle(
    postgres(connectionString, {
      prepare: false,
      connect_timeout: 8,
      fetch_types: false,
      max,
    }),
    { schema },
  );
}
