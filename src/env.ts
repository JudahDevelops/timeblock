/**
 * Validated environment access. Fails loudly at first use rather than
 * surfacing as a confusing `undefined` deep inside a request handler.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Server-only. Importing this from a Client Component is a bug. */
export const serverEnv = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  /** 32-byte key, base64. Encrypts Google refresh tokens at rest. */
  get tokenEncryptionKey() {
    return required("TOKEN_ENCRYPTION_KEY");
  },
  /** Shared secret guarding the scheduled entrypoints. */
  get cronSecret() {
    return required("CRON_SECRET");
  },
};

function requirePublic(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

/**
 * Safe to import from Client Components.
 *
 * Each getter reads `process.env.NEXT_PUBLIC_*` *statically* on purpose: Next
 * only inlines public vars into the browser bundle for literal member access,
 * so the dynamic `required()` helper above would silently yield undefined here.
 */
export const publicEnv = {
  get supabaseUrl() {
    return requirePublic("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return requirePublic(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  },
};
