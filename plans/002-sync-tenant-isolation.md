# Plan 002: Inbound sync can never write to another user's rows

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2f44196..HEAD -- src/lib/sync/engine.ts src/lib/google/auth.ts src/app/api/google/oauth/callback/route.ts "src/app/(app)/settings/integrations/page.tsx"`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — edits identity resolution in the sync engine, which is also what protects block bodies across a 410 resync
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2f44196`, 2026-09-24

## Why this matters

Timeblock is multi-user (Supabase Google sign-in, one `user_id` on every row),
but inbound sync can overwrite **another user's** event rows. There are two ways
in:

1. **Shared link rows.** `event_links` has primary key
   `(gcal_calendar_id, gcal_event_id)`, and every connection stores the literal
   alias `"primary"` as its calendar id. Google gives every attendee's copy of a
   meeting the same event id. So when two Timeblock users are invited to the
   same meeting, they share one link row. That row points at whichever user
   imported it first.
2. **`tb_event_id` in extended properties.** It is copied onto the event by
   whoever edits the Google event, so its value is not something this app
   controls.

In both cases the engine uses that id as the local event id. The user-scoped
lookup finds no row for the syncing user, so the event is treated as an import,
and the import upsert does `ON CONFLICT (id) DO UPDATE` with no user check. It
rewrites the other user's title and times and clears their `deleted_at`. This
plan is **containment**: a sync only ever writes rows its own user owns, and a
Google account can't be silently moved from one app user to another. Giving the
second invitee their own copy of a shared meeting needs the link table re-keyed,
which is deferred (see Maintenance notes).

## Current state

Files:

- `src/lib/sync/engine.ts` — inbound sync. `applyPage` (from ~line 275) resolves
  identity and writes events and links in one transaction.
- `src/lib/google/auth.ts` — `saveGrant` (line ~186) upserts the Google account.
- `src/app/api/google/oauth/callback/route.ts` — calls `saveGrant`, then upserts
  the connection with `gcalCalendarId: "primary"`.
- `src/app/(app)/settings/integrations/page.tsx` — `ERRORS` map (line 10) that
  turns `?error=` codes into fixed messages.
- `src/db/schema.ts:178-205` — `event_links`, PK `(gcal_calendar_id, gcal_event_id)`. **Do not change the schema in this plan.**

Identity resolution today (`engine.ts:309-331`):

```ts
const localIdFor = (m: MappedEvent): string | null =>
  here.get(m.gcalEventId)?.localEventId ??
  elsewhere.get(m.gcalEventId)?.localEventId ??
  m.tbEventId;

const candidates = [...new Set(mapped.map(localIdFor).filter((id): id is string => id !== null))];
const localRows = candidates.length
  ? await db
      .select({
        id: events.id,
        origin: events.origin,
        title: events.title,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        updatedAt: events.updatedAt,
        deletedAt: events.deletedAt,
      })
      .from(events)
      // Scoped by user, so an id lifted from a foreign calendar's extended
      // properties can never reach somebody else's block.
      .where(and(eq(events.userId, connection.userId), inArray(events.id, candidates)))
  : [];
const locals = new Map(localRows.map((row) => [row.id, row]));
```

The loop and the write that follows (`engine.ts:339-343`, `404-407`, `439-456`):

```ts
  for (const m of mapped) {
    const id = localIdFor(m);
    const local = id ? (locals.get(id) ?? null) : null;
    ...
    write.push({ m, id: id ?? crypto.randomUUID() });   // keeps a FOREIGN id when local is null
    ...
      await tx
        .insert(events)
        .values(rows)
        .onConflictDoUpdate({
          target: events.id,
          set: {
            title: sql`excluded.title`,
            ...
            deletedAt: sql`null`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
```

The relink path also re-derives the id (`engine.ts:491-499`):

```ts
          relink.map((m) => ({
            ...
            localEventId: locals.get(localIdFor(m)!)!.id,
```

A second latent failure: `tbEventId` is any string Google holds
(`src/lib/sync/map.ts:39`). `events.id` is a `uuid` column, so a non-UUID value
reaching `inArray(events.id, candidates)` makes Postgres throw. The page's
transaction fails, the sync token never advances, and that connection's
inbound sync is stuck for good.

`saveGrant` (`auth.ts:186-214`) silently moves an existing Google account to
the current user:

```ts
    .onConflictDoUpdate({
      target: googleAccounts.googleSub,
      set: {
        userId,
        ...
```

Repo conventions you must follow (from `CLAUDE.md`):

- Pure logic goes in `src/lib/**` with a colocated `*.test.ts`, **without**
  `import "server-only"`, so vitest can import it. `src/lib/sync/payload.ts` (pure)
  vs `push.ts` (I/O) is the reference split. `src/lib/sync/reconcile.ts` plus
  `reconcile.test.ts` is the closest exemplar for this plan's helper.
- Use `@/` imports, never `../../`.
- Comments explain **why**. Several existing comments in `applyPage` are now
  wrong (e.g. "Scoped by user, so an id lifted from a foreign calendar's
  extended properties can never reach somebody else's block"). Correct them;
  don't leave them lying.
- Route handlers redirect to settings with a snake_case `error` code, which
  the settings page maps to a fixed message. Server-side helpers throw
  typed errors (see `GoogleRevokedError` in `auth.ts:107-113`).
- Batch per page, never per row (Supabase is ~270ms away). This plan must not
  add a query per event.

## Commands you will need

| Purpose   | Command                                        | Expected on success |
| --------- | ---------------------------------------------- | ------------------- |
| Format    | `npm run format`                               | exit 0              |
| Typecheck | `npm run typecheck`                            | exit 0              |
| Lint      | `npm run lint`                                 | exit 0              |
| One test  | `npx vitest run src/lib/sync/identity.test.ts` | all pass            |
| Tests     | `npm run test`                                 | all pass            |
| Build     | `npm run build`                                | exit 0              |

## Scope

**In scope**:

- `src/lib/sync/identity.ts` (create — pure)
- `src/lib/sync/identity.test.ts` (create)
- `src/lib/sync/engine.ts`
- `src/lib/google/auth.ts`
- `src/app/api/google/oauth/callback/route.ts`
- `src/app/(app)/settings/integrations/page.tsx` (one new `ERRORS` entry only)

**Out of scope** (do NOT touch):

- `src/db/schema.ts` and anything in `drizzle/`. Re-keying `event_links` is a
  separate, riskier change with a data migration.
- `src/lib/sync/push.ts`. The outbound side is covered by plan 003.
- `reconcile.ts`. Its verdicts are correct given a correctly scoped `local`.
- Calendar-move detection (`elsewhere`, `movedOut`). Keep its behaviour
  identical for rows the user owns.

## Git workflow

- Branch: `advisor/002-sync-tenant-isolation`
- Commit style: plain imperative sentence naming the effect, e.g.
  "Keep one user's sync out of another user's blocks". One commit per step is fine.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the pure identity resolver, with tests

Create `src/lib/sync/identity.ts` (no `server-only` import, no DB):

```ts
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
): Claim;

/** `events.id` is a uuid column; anything else would abort the page's query. */
export function isUuid(value: string): boolean;
```

Rules:

- `candidate === null` → `{ kind: "fresh" }`
- `owners.get(candidate) === undefined` (no such row anywhere) → `{ kind: "fresh" }`
- `owners.get(candidate) === userId` → `{ kind: "owned", id: candidate }`
- otherwise → `{ kind: "foreign" }`

`isUuid` uses a case-insensitive RFC 4122 shape regex:
`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.

Write `src/lib/sync/identity.test.ts`, following the structure of
`src/lib/sync/reconcile.test.ts` (`describe`/`it`, `expect(...).toEqual(...)`).
Cases:

1. null candidate → fresh
2. candidate not in owners → fresh
3. candidate owned by `userId` → owned with the same id
4. candidate owned by another user → foreign
5. `isUuid` accepts a lowercase and an uppercase v4 uuid
6. `isUuid` rejects `""`, `"abc"`, a uuid with a trailing character, and a uuid missing its dashes

**Verify**: `npx vitest run src/lib/sync/identity.test.ts` → 6+ tests pass.

### Step 2: Build the ownership map in `applyPage` without adding a query

In `engine.ts` `applyPage`:

1. Filter candidates to UUIDs: `.filter((id): id is string => id !== null && isUuid(id))`.
   Treat a non-UUID `tbEventId` exactly like `null`: change `localIdFor` so its
   last fallback is `m.tbEventId && isUuid(m.tbEventId) ? m.tbEventId : null`.
2. Change the existing `localRows` query to **drop the `eq(events.userId, …)`
   filter** and add `userId: events.userId` to the selected columns. Keep
   `inArray(events.id, candidates)`. It is still one query.
3. Build `owners = new Map(localRows.map((r) => [r.id, r.userId]))` and
   `locals = new Map(localRows.filter((r) => r.userId === connection.userId).map((r) => [r.id, r]))`.
   Everything after this point reads `locals`, which stays user-scoped.
4. Replace the misleading "Scoped by user…" comment with one explaining why
   the read is deliberately unscoped: the only way to know an id is someone
   else's is to see who owns it, and the write below is what must be scoped.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Resolve each event through `claimLocalId` and skip foreign ones

At the top of the `for (const m of mapped)` loop, replace
`const id = localIdFor(m);` with:

```ts
const claim = claimLocalId(localIdFor(m), owners, connection.userId);
if (claim.kind === "foreign") {
  outcome.foreign++;
  continue;
}
const id = claim.kind === "owned" ? claim.id : null;
const local = id ? (locals.get(id) ?? null) : null;
```

Add `foreign: number` to `SyncOutcome` (with a one-line doc comment: "events
whose identity belongs to another user; left alone rather than written"), and
`foreign: 0` to `NOTHING`. `PageOutcome` derives from `SyncOutcome`, so the
summing loop in `runSync` picks it up automatically.

The rest of the loop is unchanged. For `"fresh"`, `id` is `null`, so the
existing `write.push({ m, id: id ?? crypto.randomUUID() })` mints a new uuid.

Change the `relink` array to carry the resolved id,
`relink: Array<{ m: MappedEvent; id: string }>`, push `{ m, id: local.id }`, and
use it in the link upsert instead of `locals.get(localIdFor(m)!)!.id`.

**Verify**:

- `npm run typecheck` → exit 0
- `grep -n "localIdFor(m)!" src/lib/sync/engine.ts` → no matches

### Step 4: Scope the events upsert itself (belt and braces)

On the `tx.insert(events)...onConflictDoUpdate({...})` in `applyPage`, add:

```ts
setWhere: sql`${events.userId} = excluded.user_id`,
```

The option is supported: `node_modules/drizzle-orm/pg-core/query-builders/insert.d.ts:66`.
Add a short why-comment: even if identity resolution regresses, Postgres
refuses to rewrite a row owned by someone else.

**Verify**: `npm run typecheck && npm run build` → exit 0.

### Step 5: Refuse to move a Google account between app users

In `src/lib/google/auth.ts`:

1. Add, next to `GoogleRevokedError`:
   ```ts
   /** The Google account is already connected to a different Timeblock user. */
   export class GoogleAccountClaimedError extends Error {
     constructor() {
       super("Google account is connected to another user");
       this.name = "GoogleAccountClaimedError";
     }
   }
   ```
2. At the start of `saveGrant`, select `googleAccounts.userId` where
   `googleSub = tokens.googleSub`. If a row exists and its `userId !== userId`,
   throw `new GoogleAccountClaimedError()`. Keep the upsert as is (same-user
   reconnect must still work: it clears `revokedAt` and refreshes tokens).

In `src/app/api/google/oauth/callback/route.ts`, inside the existing
`catch (cause)` around `exchangeCode`/`saveGrant`: if
`cause instanceof GoogleAccountClaimedError`, return
`back(request, { error: "account_in_use" })` **before** the generic
`console.error` and `exchange_failed` return.

In `src/app/(app)/settings/integrations/page.tsx`, add to `ERRORS`:
`account_in_use: "That Google account is already connected to a different Timeblock account.",`

**Verify**:

- `npm run typecheck && npm run lint` → exit 0
- `grep -n "account_in_use" src/app/api/google/oauth/callback/route.ts "src/app/(app)/settings/integrations/page.tsx"` → one match in each

### Step 6: Full gate

**Verify**: `npm run format && npm run typecheck && npm run lint && npm run test && npm run build` → all exit 0.

## Test plan

- New: `src/lib/sync/identity.test.ts` (Step 1), covering the four claim
  outcomes and UUID validation.
- There is no DB fixture layer in this repo (by design; see `CLAUDE.md` →
  Testing), so the engine wiring is verified by typecheck/build and review.
- Optional read-only probe, if `.env.local` is present. Create
  `probe.mts` in the repo root:
  `npx tsx --conditions=react-server --env-file=.env.local probe.mts`.
  Have it count `event_links` rows whose `local_event_id` belongs to a user
  different from any connection's user for the same Google account. It is a
  diagnostic only, so report the number. **Delete the script afterwards**, and
  never run writes from it.

## Done criteria

- [ ] `npx vitest run src/lib/sync/identity.test.ts` passes with ≥ 6 tests
- [ ] `grep -n "claimLocalId" src/lib/sync/engine.ts` → at least one match
- [ ] `grep -n "setWhere" src/lib/sync/engine.ts` → one match on the events upsert
- [ ] `grep -n "GoogleAccountClaimedError" src/lib/google/auth.ts src/app/api/google/oauth/callback/route.ts` → matches in both
- [ ] `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all exit 0
- [ ] `git status` shows only in-scope files modified; no `probe.mts` left behind
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `applyPage` no longer has the `localIdFor` / `locals` / `write` structure excerpted above.
- The fix appears to need a schema change or migration. That is the deferred
  re-keying work, not this plan.
- Any existing test in `src/lib/sync/*.test.ts` fails after your change.
- You find a code path other than `applyPage` that writes `events` rows from
  Google data without a user filter. Report it rather than widening scope.

## Maintenance notes

- **Known remaining limitation, by design of this plan:** when two users are
  invited to the same meeting, the second one to sync won't see it. Their sync
  now counts it as `foreign` and skips it instead of corrupting the first user's
  block. The real fix is to stop using the `"primary"` alias as the link's
  calendar key. Store the real calendar id (`getCalendar(token, "primary").id`,
  already exposed by `src/lib/google/client.ts:159`), or add `user_id` or
  `connection_id` to the `event_links` primary key, and migrate existing rows.
  That also unblocks multi-calendar (v1.3). Plan it separately.
- A non-zero `foreign` count in `/api/sync/run` responses is the signal that
  the limitation above is affecting real users.
- Reviewer: confirm that `dead`, `movedOut` and `relink` still only act on ids
  present in the user-scoped `locals` map.
