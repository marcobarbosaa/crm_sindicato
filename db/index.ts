import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export function getDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is unavailable. Configure the Supabase PostgreSQL connection before using the database."
    );
  }

  return drizzle(postgres(connectionString, { prepare: false }), { schema });
}
