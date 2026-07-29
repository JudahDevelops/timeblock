/**
 * Applies a raw .sql file to DATABASE_URL.
 *
 * Exists because drizzle-kit has no concept of RLS policies or grants, and
 * those are load-bearing for this project's security rather than a nicety.
 *
 *   npx tsx scripts/apply-sql.ts drizzle/rls.sql
 */
import { readFileSync } from "node:fs";

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const file = process.argv[2];
if (!file) {
  console.error("Usage: tsx scripts/apply-sql.ts <file.sql>");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Fill in .env.local.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });

async function main() {
  try {
    await sql.unsafe(readFileSync(file, "utf8"));
    console.log(`Applied ${file}`);
  } catch (error) {
    console.error(`Failed to apply ${file}:`, error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

void main();
