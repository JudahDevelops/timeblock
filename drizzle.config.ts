import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Next reads .env.local automatically; drizzle-kit does not.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
