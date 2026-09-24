export type Claim =
  | { kind: "owned"; id: string } // an existing row belonging to this user
  | { kind: "fresh" } // nothing usable: mint a new id
  | { kind: "foreign" }; // an existing row belonging to someone else: never write

/**
 * Decides whose row a Google event is allowed to land on.
 * `owners` maps every candidate id that exists in `events` to its `user_id`,
 * across ALL users — that is what makes "foreign" detectable at all.
 */
export function claimLocalId(
  candidate: string | null,
  owners: ReadonlyMap<string, string>,
  userId: string,
): Claim {
  if (candidate === null) return { kind: "fresh" };
  const owner = owners.get(candidate);
  if (owner === undefined) return { kind: "fresh" };
  if (owner === userId) return { kind: "owned", id: candidate };
  return { kind: "foreign" };
}

/** `events.id` is a uuid column; anything else would abort the page's query. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
