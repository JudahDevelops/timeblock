export type Claim<R> =
  | { kind: "owned"; row: R } // an existing row belonging to this user
  | { kind: "fresh" } // nothing usable: mint a new id
  | { kind: "foreign" }; // an existing row belonging to someone else: never write

/**
 * Decides whose row a Google event is allowed to land on.
 * `rows` holds every candidate id that exists in `events` with its `userId`,
 * across ALL users — that is what makes "foreign" detectable at all.
 */
export function claimLocalId<R extends { userId: string }>(
  candidate: string | null,
  rows: ReadonlyMap<string, R>,
  userId: string,
): Claim<R> {
  if (candidate === null) return { kind: "fresh" };
  const row = rows.get(candidate);
  if (row === undefined) return { kind: "fresh" };
  if (row.userId === userId) return { kind: "owned", row };
  return { kind: "foreign" };
}

/** `events.id` is a uuid column; anything else would abort the page's query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
