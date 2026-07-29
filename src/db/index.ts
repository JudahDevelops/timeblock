import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverEnv } from "@/env";
import * as schema from "./schema";

declare global {
  var __timeblockSql: ReturnType<typeof postgres> | undefined;
}

// Reuse the pool across hot reloads in dev, otherwise every edit leaks connections.
const client =
  globalThis.__timeblockSql ??
  postgres(serverEnv.databaseUrl, {
    prepare: false, // Supabase transaction-mode pooler does not support prepared statements
    max: 5,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__timeblockSql = client;
}

export const db = drizzle(client, { schema });
export { schema };
