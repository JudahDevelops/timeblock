import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { calendarConnections, googleAccounts } from "@/db/schema";
import { secretsMatch } from "@/lib/crypto";
import { getAccessToken, GoogleRevokedError } from "@/lib/google/auth";
import {
  isWatchable,
  needsRenewal,
  parseExpiration,
  watchTtlSeconds,
  webhookAddress,
  type Ping,
} from "@/lib/google/channel";
import { GoogleApiError, stopChannel, watchEvents } from "@/lib/google/client";

/**
 * Push-notification channels: opening them, replacing them before they lapse,
 * and tracing a ping back to the connection it belongs to.
 *
 * A channel is an optimisation, never a dependency. Everything here degrades to
 * the five-minute poll, which is why nothing in this file throws into a user
 * flow — the worst outcome is a calendar that updates in minutes rather than
 * seconds, and that is not worth failing a connect over.
 */

type Connection = typeof calendarConnections.$inferSelect;

export type ChannelOutcome =
  | "watching"
  /** Already live and not near expiry. */
  | "current"
  /** No public HTTPS address, so Google has nowhere to deliver. */
  | "unsupported"
  /** Grant is gone, or Google refused. Polling carries on regardless. */
  | "failed";

/**
 * Opens a channel for this calendar, replacing any that is close to lapsing.
 *
 * Channel expiry is the silent death mode for this integration — nothing
 * errors, notifications simply stop — so this is called on connect and again
 * every hour rather than only when something looks wrong.
 */
export async function ensureChannel(connectionId: string): Promise<ChannelOutcome> {
  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1);

  if (!connection) return "failed";
  return ensureChannelFor(connection);
}

async function ensureChannelFor(connection: Connection): Promise<ChannelOutcome> {
  // Localhost can never be watched, and a dev server that tried would collect a
  // confusing 400 on every connect.
  if (!isWatchable()) return "unsupported";
  if (connection.channelId && !needsRenewal(connection.channelExpiration)) return "current";

  let accessToken: string;
  try {
    accessToken = await getAccessToken(connection.googleAccountId);
  } catch (cause) {
    if (cause instanceof GoogleRevokedError) return "failed";
    throw cause;
  }

  // Closed before the replacement opens, so a change is never delivered twice
  // under two live channels. A gap of one request is covered by the poll.
  await stopExisting(accessToken, connection);

  const channelId = randomUUID();
  // The ping carries an empty body and no signature. This is the entire
  // authentication story, so it is a real secret, not an identifier.
  const token = randomBytes(32).toString("base64url");

  try {
    const channel = await watchEvents(accessToken, connection.gcalCalendarId, {
      id: channelId,
      token,
      address: webhookAddress(),
      ttlSeconds: watchTtlSeconds(),
    });

    await db
      .update(calendarConnections)
      .set({
        channelId,
        channelResourceId: channel.resourceId,
        channelToken: token,
        // Google's own expiry, not the TTL we asked for: it may grant less, and
        // trusting our own number would leave a short channel to die quietly.
        channelExpiration: parseExpiration(channel.expiration),
      })
      .where(eq(calendarConnections.id, connection.id));

    return "watching";
  } catch (cause) {
    if (!(cause instanceof GoogleApiError) && !(cause instanceof GoogleRevokedError)) throw cause;
    console.error(`Could not watch calendar for connection ${connection.id}`, cause);
    await clearChannel(connection.id);
    return "failed";
  }
}

/**
 * Renews every channel that needs it. The hourly cron's whole job.
 *
 * Runs across all users with the service role, so it filters nothing — but it
 * also writes nothing outside `calendar_connections`.
 */
export async function renewChannels(): Promise<Record<ChannelOutcome, number>> {
  const connections = await db
    .select()
    .from(calendarConnections)
    .innerJoin(googleAccounts, eq(calendarConnections.googleAccountId, googleAccounts.id))
    .where(isNull(googleAccounts.revokedAt));

  const tally: Record<ChannelOutcome, number> = {
    watching: 0,
    current: 0,
    unsupported: 0,
    failed: 0,
  };

  for (const row of connections) {
    try {
      tally[await ensureChannelFor(row.calendar_connections)]++;
    } catch (cause) {
      // One unreachable calendar must not leave the rest to expire.
      console.error(`Channel renewal failed for connection ${row.calendar_connections.id}`, cause);
      tally.failed++;
    }
  }

  return tally;
}

/**
 * Closes the channel for a connection being torn down.
 *
 * Best-effort on purpose: the row is about to go, and a channel we failed to
 * stop expires on its own within a week — its pings arrive with a token no
 * connection matches and are rejected in the meantime.
 */
export async function stopWatch(connectionId: string): Promise<void> {
  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, connectionId))
    .limit(1);

  if (!connection?.channelId) return;

  try {
    await stopExisting(await getAccessToken(connection.googleAccountId), connection);
  } catch (cause) {
    console.error(`Could not stop channel for connection ${connectionId}`, cause);
  }
}

async function stopExisting(accessToken: string, connection: Connection): Promise<void> {
  if (!connection.channelId || !connection.channelResourceId) return;

  try {
    await stopChannel(accessToken, {
      id: connection.channelId,
      resourceId: connection.channelResourceId,
    });
  } catch (cause) {
    // Already expired or already stopped is the state we were aiming for.
    if (!(cause instanceof GoogleApiError) || !cause.isGone) throw cause;
  }
}

async function clearChannel(connectionId: string): Promise<void> {
  await db
    .update(calendarConnections)
    .set({
      channelId: null,
      channelResourceId: null,
      channelToken: null,
      channelExpiration: null,
    })
    .where(eq(calendarConnections.id, connectionId));
}

/**
 * The connection a ping belongs to, or nothing.
 *
 * Both halves matter. The channel id says which row to look at; the token says
 * whether to believe the request at all, and it is compared in constant time
 * because it is the only credential a notification carries.
 */
export async function connectionForPing(ping: Ping): Promise<{ id: string } | null> {
  const [connection] = await db
    .select({ id: calendarConnections.id, token: calendarConnections.channelToken })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.channelId, ping.channelId),
        eq(calendarConnections.channelResourceId, ping.resourceId),
      ),
    )
    .limit(1);

  if (!connection?.token || !secretsMatch(ping.token, connection.token)) return null;
  return { id: connection.id };
}
