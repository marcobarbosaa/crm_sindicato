import { env } from "cloudflare:workers";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export function getDb() {
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
    }),
    { schema },
  );
}
