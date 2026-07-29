import "server-only";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

/** Google's own maximum for `events.list`. */
const PAGE_SIZE = 250;

export type GoogleDateTime = {
  /** Set for timed events. */
  dateTime?: string;
  /** Set for all-day events; the end date is exclusive. */
  date?: string;
  timeZone?: string;
};

export type GoogleEvent = {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  updated?: string;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleDateTime;
  extendedProperties?: { private?: Record<string, string> };
};

export type EventsPage = {
  items: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }

  /** A dead sync token. The caller must start again from a full sync. */
  get isSyncTokenExpired(): boolean {
    return this.status === 410;
  }

  /**
   * The event is not there. On a delete that is success by another name, and on
   * a patch it means someone removed it in Google while we still held a link.
   */
  get isGone(): boolean {
    return this.status === 404 || this.status === 410;
  }

  /** The grant does not cover writes — the user consented to read-only. */
  get isForbidden(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/**
 * How far back a first sync reaches.
 *
 * Bounded because `singleEvents` expands every recurring series into instances,
 * and a decade-old calendar of weekly standups is a great deal of rows for
 * nothing anyone will scroll to. The sync token issued against this window
 * carries it forward, so incremental syncs stay consistent with it.
 */
const HISTORY_DAYS = 180;

/**
 * Bounded forwards for the same reason, and it is not hypothetical: a contacts
 * birthday recurs yearly with no end, and Google expanded eighteen of them into
 * 558 instances stretching three decades out — 98% of the first real import.
 */
const FUTURE_DAYS = 365;

export type SyncWindow = { timeMin: Date; timeMax: Date };

/**
 * The slice of the calendar this app tracks.
 *
 * Named and returned rather than inlined below because it is a policy, not a
 * detail of one request: the sync also has to know what it *didn't* ask for, to
 * recognise a local row the window no longer covers.
 */
export function syncWindow(now = Date.now()): SyncWindow {
  return {
    timeMin: new Date(now - HISTORY_DAYS * 86_400_000),
    timeMax: new Date(now + FUTURE_DAYS * 86_400_000),
  };
}

export function fullSyncParams(window: SyncWindow = syncWindow()): URLSearchParams {
  return new URLSearchParams({
    // Instances, not rules: the grid draws concrete blocks, and this keeps
    // recurrence expansion on Google's side where it is already correct.
    singleEvents: "true",
    // Cancellations have to arrive as rows, or a deleted meeting lingers here.
    showDeleted: "true",
    maxResults: String(PAGE_SIZE),
    timeMin: window.timeMin.toISOString(),
    timeMax: window.timeMax.toISOString(),
  });
}

/**
 * Parameters for an incremental call.
 *
 * Deliberately nothing but the token and page size. Google rejects `timeMin`
 * alongside `syncToken` outright, and the window the token was minted against
 * is already baked into it.
 */
export function incrementalParams(syncToken: string): URLSearchParams {
  return new URLSearchParams({ maxResults: String(PAGE_SIZE), syncToken });
}

async function call<T>(
  accessToken: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${CALENDAR_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  if (!response.ok) throw await toApiError(response);
  // `events.delete` answers 204 with no body, and `.json()` would throw on it.
  if (response.status === 204) return undefined as T;
  return response.json();
}

function eventsPath(calendarId: string): string {
  return `/calendars/${encodeURIComponent(calendarId)}/events`;
}

export async function listEvents(
  accessToken: string,
  calendarId: string,
  params: URLSearchParams,
  pageToken?: string,
): Promise<EventsPage> {
  const query = new URLSearchParams(params);
  if (pageToken) query.set("pageToken", pageToken);
  return call(accessToken, `${eventsPath(calendarId)}?${query}`);
}

/** The user's own calendar list, for showing which one is being synced. */
export async function getCalendar(
  accessToken: string,
  calendarId: string,
): Promise<{ id: string; summary?: string; timeZone?: string }> {
  return call(accessToken, `/calendars/${encodeURIComponent(calendarId)}`);
}

/** The fields we send. Anything absent stays whatever Google already had. */
export type EventWrite = {
  summary: string;
  description: string;
  start: GoogleDateTime;
  end: GoogleDateTime;
  extendedProperties: { private: Record<string, string> };
};

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  event: EventWrite,
): Promise<GoogleEvent> {
  return call(accessToken, eventsPath(calendarId), { method: "POST", body: event });
}

/**
 * PATCH, not PUT. A full update would blank every field we do not send —
 * attendees, conferencing, colour, reminders — and those belong to the user,
 * not to us.
 */
export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: Partial<EventWrite>,
): Promise<GoogleEvent> {
  return call(accessToken, `${eventsPath(calendarId)}/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: event,
  });
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await call(accessToken, `${eventsPath(calendarId)}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
}

/** What Google hands back when a channel opens. `expiration` is epoch ms. */
export type Channel = { id: string; resourceId: string; expiration?: string };

/**
 * Asks Google to notify `address` when this calendar changes.
 *
 * `token` is echoed back on every notification and is the *only* authentication
 * a ping carries — the body is empty and nothing is signed. `id` is ours to
 * choose and is how a ping is traced back to a connection.
 */
export async function watchEvents(
  accessToken: string,
  calendarId: string,
  channel: { id: string; token: string; address: string; ttlSeconds: number },
): Promise<Channel> {
  return call(accessToken, `${eventsPath(calendarId)}/watch`, {
    method: "POST",
    body: {
      id: channel.id,
      type: "web_hook",
      address: channel.address,
      token: channel.token,
      params: { ttl: String(channel.ttlSeconds) },
    },
  });
}

/**
 * Closes a channel early.
 *
 * Both ids are required: Google keys a channel by the pair, and `resourceId` is
 * only ever learned from the `watch` response, which is why it is stored.
 */
export async function stopChannel(
  accessToken: string,
  channel: { id: string; resourceId: string },
): Promise<void> {
  await call(accessToken, "/channels/stop", {
    method: "POST",
    body: { id: channel.id, resourceId: channel.resourceId },
  });
}

async function toApiError(response: Response): Promise<GoogleApiError> {
  const body = await response.text();
  let reason = "";
  let message = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body);
    reason = parsed?.error?.errors?.[0]?.reason ?? parsed?.error?.status ?? "";
    message = parsed?.error?.message ?? message;
  } catch {
    // A non-JSON body is already captured above.
  }
  return new GoogleApiError(response.status, reason, `Google ${response.status}: ${message}`);
}
