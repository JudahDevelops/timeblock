import { publicEnv } from "@/env";

/**
 * Push-notification policy, kept pure.
 *
 * Everything here is arithmetic and header reading — the part of the webhook
 * story that is easy to get quietly wrong and impossible to notice, because a
 * dead channel fails by going silent rather than by throwing. `channels.ts`
 * holds the database and the Google calls.
 */

/** Where Google is told to deliver. Excluded from the auth gate in `proxy.ts`. */
export const WEBHOOK_PATH = "/api/google/webhook";

/**
 * Google's own ceiling for a calendar channel, and it cannot be extended —
 * renewal means opening a new channel, never refreshing this one.
 */
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How far ahead of expiry a channel is replaced.
 *
 * A full day of slack against an hourly cron. Channel expiry is the classic
 * silent death for this integration: nothing errors, notifications simply stop
 * and the calendar quietly goes stale, so the margin is deliberately far wider
 * than it needs to be.
 */
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

export function watchTtlSeconds(): number {
  return MAX_TTL_SECONDS;
}

export function webhookAddress(appUrl: string = publicEnv.appUrl): string {
  return new URL(WEBHOOK_PATH, appUrl).toString();
}

/**
 * Whether Google will accept this deployment as a delivery target.
 *
 * It requires HTTPS on a domain verified in Search Console, so a localhost dev
 * server can never be watched. Answering that here — rather than letting the
 * `watch` call fail — is what lets a connection fall back to polling with an
 * honest explanation instead of a red error the user cannot act on.
 */
export function isWatchable(appUrl: string = publicEnv.appUrl): boolean {
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  return url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
}

/** Google reports expiry as epoch milliseconds in a string. */
export function parseExpiration(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms);
}

/**
 * Whether a channel is missing, spent, or close enough to expiry to replace.
 *
 * Trusts the expiry Google returned rather than assuming the TTL we asked for:
 * Google is free to grant less, and hardcoding seven days here would leave a
 * shortened channel to die between renewal runs.
 */
export function needsRenewal(expiration: Date | null, now: Date = new Date()): boolean {
  if (!expiration) return true;
  return expiration.getTime() - now.getTime() <= RENEW_BEFORE_MS;
}

/** Whether notifications are actually arriving, as far as the record shows. */
export function isWatchLive(expiration: Date | null, now: Date = new Date()): boolean {
  return expiration !== null && expiration.getTime() > now.getTime();
}

/**
 * Three missed polls.
 *
 * The poll runs every five minutes and touches `last_inbound_ok_at` even when
 * it finds nothing, so silence for this long is not a quiet calendar — it is a
 * cron that stopped, a grant that lapsed, or a deploy that broke the sync.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Whether inbound sync has gone quiet.
 *
 * The alarm for the failure this whole phase invites: a channel that has
 * expired or a poll that has stopped both look exactly like a calendar where
 * nothing is happening, and there is no error anywhere to notice. A connection
 * that has never synced is not stale — it is new.
 */
export function isInboundStale(lastInboundOkAt: Date | null, now: Date = new Date()): boolean {
  if (!lastInboundOkAt) return false;
  return now.getTime() - lastInboundOkAt.getTime() > STALE_AFTER_MS;
}

/**
 * What a notification carries. `sync` is the handshake Google sends the moment
 * a channel opens; every later ping is `exists` and means something changed.
 */
export type Ping = {
  channelId: string;
  resourceId: string;
  token: string;
  state: "sync" | "exists" | "not_exists" | string;
};

/**
 * Reads a notification, or nothing if it is not one.
 *
 * The payload is an empty body with no signature of any kind — these headers
 * are all there is, and `token` is the only thing separating a real ping from
 * anyone who guessed the URL.
 */
export function readPing(headers: Headers): Ping | null {
  const channelId = headers.get("x-goog-channel-id");
  const resourceId = headers.get("x-goog-resource-id");
  const state = headers.get("x-goog-resource-state");
  if (!channelId || !resourceId || !state) return null;

  return { channelId, resourceId, state, token: headers.get("x-goog-channel-token") ?? "" };
}
