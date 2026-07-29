import "server-only";

import { OAuth2Client } from "google-auth-library";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { googleAccounts } from "@/db/schema";
import { publicEnv, serverEnv } from "@/env";
import { seal, unseal } from "@/lib/crypto";

/**
 * Read-only for now. Phase 5 renders Google events and writes nothing, and
 * asking only for what we use means the API itself rejects a write — a stronger
 * guarantee than our own discipline while the sync engine is unproven.
 *
 * Phase 7 widens this to `.../auth/calendar`; `include_granted_scopes` below
 * makes that an incremental upgrade rather than a fresh grant.
 */
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
];

/** Refresh this far ahead of expiry, so a slow request cannot outlive its token. */
const REFRESH_SKEW_MS = 120_000;

export const OAUTH_REDIRECT_PATH = "/api/google/oauth/callback";

export function oauthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: serverEnv.googleClientId,
    clientSecret: serverEnv.googleClientSecret,
    redirectUri: `${publicEnv.appUrl}${OAUTH_REDIRECT_PATH}`,
  });
}

/**
 * Where to send the browser to start a calendar grant.
 *
 * `access_type=offline` with `prompt=consent` is what makes Google return a
 * refresh token. Without the forced prompt it is issued only on the very first
 * grant, so a user who reconnects after we lost their token gets an access
 * token that expires in an hour and never comes back.
 */
export function authorizeUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: CALENDAR_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

export type GrantedTokens = {
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
  scopes: string[];
  googleSub: string;
  email: string;
};

/** Exchanges the callback's `code`. Throws if Google withheld a refresh token. */
export async function exchangeCode(code: string): Promise<GrantedTokens> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token || !tokens.access_token || !tokens.id_token) {
    throw new Error("Google did not return a full token set");
  }

  // Verifying rather than decoding: the id_token is what tells us *which*
  // Google account this is, and that decides which rows the sync writes to.
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: serverEnv.googleClientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error("Google id_token has no subject");

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3_600_000),
    scopes: tokens.scope?.split(" ") ?? CALENDAR_SCOPES,
    googleSub: payload.sub,
    email: payload.email ?? "",
  };
}

/** Raised when Google has revoked the grant; the UI turns this into a reconnect banner. */
export class GoogleRevokedError extends Error {
  constructor(readonly accountId: string) {
    super("Google access was revoked");
    this.name = "GoogleRevokedError";
  }
}

/**
 * A usable access token for an account, refreshing if it is close to expiry.
 *
 * The whole read-check-refresh-write sequence runs inside one transaction with
 * `SELECT ... FOR UPDATE`. Two syncs starting together would otherwise both see
 * a stale token and both refresh; Google invalidates the older access token
 * each time, so the loser would then make calls with a token that just died.
 */
export async function getAccessToken(accountId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(googleAccounts)
      .where(eq(googleAccounts.id, accountId))
      .for("update")
      .limit(1);

    if (!account) throw new Error(`Unknown Google account ${accountId}`);
    if (account.revokedAt) throw new GoogleRevokedError(accountId);

    const fresh =
      account.accessTokenEnc &&
      account.accessExpiresAt &&
      account.accessExpiresAt.getTime() - Date.now() > REFRESH_SKEW_MS;

    if (fresh && account.accessTokenEnc) return unseal(account.accessTokenEnc);

    const client = oauthClient();
    client.setCredentials({ refresh_token: unseal(account.refreshTokenEnc) });

    let accessToken: string;
    let expiresAt: Date;
    try {
      const { credentials } = await client.refreshAccessToken();
      if (!credentials.access_token) throw new Error("Google returned no access token");
      accessToken = credentials.access_token;
      expiresAt = new Date(credentials.expiry_date ?? Date.now() + 3_600_000);
    } catch (error) {
      // `invalid_grant` means the user revoked us, changed their password, or
      // the token went unused too long. It never recovers by retrying.
      if (isInvalidGrant(error)) {
        await tx
          .update(googleAccounts)
          .set({ revokedAt: new Date() })
          .where(eq(googleAccounts.id, accountId));
        throw new GoogleRevokedError(accountId);
      }
      throw error;
    }

    await tx
      .update(googleAccounts)
      .set({ accessTokenEnc: seal(accessToken), accessExpiresAt: expiresAt })
      .where(eq(googleAccounts.id, accountId));

    return accessToken;
  });
}

function isInvalidGrant(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { message, response } = error as {
    message?: string;
    response?: { data?: { error?: string } };
  };
  return response?.data?.error === "invalid_grant" || Boolean(message?.includes("invalid_grant"));
}

/**
 * Stores a fresh grant, keyed on the Google account rather than ours: connecting
 * the same Google account twice must update one row, not accumulate them.
 */
export async function saveGrant(userId: string, tokens: GrantedTokens): Promise<string> {
  const [row] = await db
    .insert(googleAccounts)
    .values({
      userId,
      googleSub: tokens.googleSub,
      email: tokens.email,
      refreshTokenEnc: seal(tokens.refreshToken),
      accessTokenEnc: seal(tokens.accessToken),
      accessExpiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
    })
    .onConflictDoUpdate({
      target: googleAccounts.googleSub,
      set: {
        userId,
        email: tokens.email,
        refreshTokenEnc: seal(tokens.refreshToken),
        accessTokenEnc: seal(tokens.accessToken),
        accessExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        // Reconnecting is precisely how a revoked account comes back.
        revokedAt: sql`null`,
      },
    })
    .returning({ id: googleAccounts.id });

  return row.id;
}
