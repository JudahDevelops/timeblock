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

export async function listEvents(
  accessToken: string,
  calendarId: string,
  params: URLSearchParams,
  pageToken?: string,
): Promise<EventsPage> {
  const query = new URLSearchParams(params);
  if (pageToken) query.set("pageToken", pageToken);

  const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${query}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) throw await toApiError(response);
  return response.json();
}

/** The user's own calendar list, for showing which one is being synced. */
export async function getCalendar(
  accessToken: string,
  calendarId: string,
): Promise<{ id: string; summary?: string; timeZone?: string }> {
  const response = await fetch(`${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw await toApiError(response);
  return response.json();
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
