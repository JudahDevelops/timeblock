# Plan 003: The push sweep picks only real work, retries every withdrawal, and never recreates a deleted event

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2f44196..HEAD -- src/lib/sync/push.ts src/lib/sync/engine.ts`
> Plan 002 is expected to have changed `engine.ts` (identity resolution in
> `applyPage`). Those changes are fine. Only the regions excerpted below
> (`purgeTombstones`, and the `live` links upsert inside `applyPage`) must still
> match. Any mismatch in `push.ts` is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — changes which rows reach Google; a wrong predicate either stops pushing or pushes too much
- **Depends on**: plans/002-sync-tenant-isolation.md (touches the same file, `engine.ts`; land 002 first to avoid a merge conflict)
- **Category**: bug
- **Planned at**: commit `2f44196`, 2026-09-24

## Why this matters

`pushPending` is the safety net behind every inline push: the 5-minute cron runs
it before each pull. Its query selects any local-origin row with **no live
link**. That includes every deleted block whose withdrawal already succeeded,
since success retires the link, and every row `isPushable` will reject. Those
rows sit in the selection for 30 days, until `purgeTombstones` removes them.
The query has `LIMIT 50` and no `ORDER BY`, so after a user deletes ~50 blocks
the sweep can spend its whole budget on dead rows. Real pending edits then never
retry. Each dead row also costs about 7 database round trips at ~270ms
(connection lookup, token refresh transaction, link lookup…), so 50 of them
blow the route's 60s `maxDuration` before the pull even starts.

Three correctness bugs sit in the same code:

- **Google-origin deletions are never retried.** `pushEvent` deliberately
  allows withdrawing Google-origin events, but `pushPending` filters to
  `origin = 'local'`. So one failed inline delete leaves the event live in
  Google. `purgeTombstones` then deletes the tombstone after 30 days, and the
  next full resync imports the event again. The deleted meeting comes back.
- **A link retired because the event was deleted in Google gets recreated.**
  `pushEvent` retires the link on a 404/410 PATCH "so the block stays local".
  But the row then has no live link, so the next sweep selects it and
  `pushEvent` falls through to `insertEvent`.
- **Every remote edit the pull applies is PATCHed straight back to Google.**
  The pull sets `events.updated_at = now` but leaves `event_links.last_pushed_at`
  alone, so the sweep reads the row as locally changed.

## Current state

Files:

- `src/lib/sync/push.ts` — `pushEvent` (line 26), `writableConnection` (line 165),
  `pushPending` (line 191), `pushEventBestEffort` (line 234).
- `src/lib/sync/engine.ts` — `purgeTombstones` (~line 239) and the links upsert
  for `live` rows inside `applyPage` (~lines 458-479).
- Callers: `src/app/api/sync/run/route.ts:80` (`pushPending(userId)`),
  `src/server/actions/events.ts:25` (`after(() => pushEventBestEffort(userId, eventId))`).
  Their call signatures must keep working unchanged.

`pushPending` today (`push.ts:191-230`):

```ts
export async function pushPending(userId: string, limit = 50): Promise<Record<PushResult, number>> {
  const pending = await db
    .select({ id: events.id })
    .from(events)
    .leftJoin(eventLinks, and(eq(eventLinks.localEventId, events.id), isNull(eventLinks.deletedAt)))
    .where(
      and(
        eq(events.userId, userId),
        eq(events.origin, "local"),
        or(
          isNull(eventLinks.gcalEventId),
          isNull(eventLinks.lastPushedAt),
          lt(eventLinks.lastPushedAt, events.updatedAt),
          // A local deletion still has to reach Google, and its link is still
          // live until the delete succeeds.
          and(isNotNull(events.deletedAt), isNull(eventLinks.deletedAt)),
        ),
      ),
    )
    .limit(limit);

  const tally: Record<PushResult, number> = { created: 0, updated: 0, deleted: 0, skipped: 0 };

  for (const row of pending) {
    try {
      tally[await pushEvent(userId, row.id)]++;
    } catch (cause) {
      if (cause instanceof GoogleRevokedError) throw cause;
      console.error(`Push failed for event ${row.id}`, cause);
      tally.skipped++;
    }
  }
  return tally;
}
```

`pushEvent`'s gate and link lookup (`push.ts:39-57`). The lookup does **not**
filter `deleted_at` and has no order, so it may return a retired link:

```ts
const withdrawing = event.deletedAt !== null && event.recurringEventId === null;
if (!withdrawing && !isPushable(event)) return "skipped";

const target = await writableConnection(userId);
if (!target) return "skipped";

const { connection, accessToken } = target;

const [link] = await db
  .select()
  .from(eventLinks)
  .where(
    and(
      eq(eventLinks.localEventId, eventId),
      eq(eventLinks.gcalCalendarId, connection.gcalCalendarId),
    ),
  )
  .limit(1);
```

…and it falls through to `insertEvent` whenever `!(link && !link.deletedAt)` (`push.ts:86-119`).

`isPushable` (`src/lib/sync/payload.ts:35`):
`return event.origin === "local" && event.recurringEventId === null;`

`purgeTombstones` (`engine.ts` ~239-255) deletes any tombstone older than 30 days
with `body_rev = 0`, regardless of whether its withdrawal ever reached Google:

```ts
    .delete(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.bodyRev, 0),
        isNotNull(events.deletedAt),
        lt(events.deletedAt, cutoff),
      ),
    )
```

The pull's links upsert for written rows (`engine.ts` ~458-479) leaves
`last_pushed_at` untouched:

```ts
await tx
  .insert(eventLinks)
  .values(
    live.map((m, i) => ({
      gcalCalendarId: connection.gcalCalendarId,
      gcalEventId: m.gcalEventId,
      localEventId: rows[i].id,
      gcalEtag: m.etag,
      gcalUpdated: m.updated,
      lastPulledAt: now,
      deletedAt: null,
    })),
  )
  .onConflictDoUpdate({
    target: [eventLinks.gcalCalendarId, eventLinks.gcalEventId],
    set: {
      localEventId: sql`excluded.local_event_id`,
      gcalEtag: sql`excluded.gcal_etag`,
      gcalUpdated: sql`excluded.gcal_updated`,
      lastPulledAt: sql`excluded.last_pulled_at`,
      deletedAt: sql`null`,
    },
  });
```

Rules from `CLAUDE.md` that this plan must keep:

- "When local wins a conflict, clearing `event_links.last_pushed_at` is what
  resolves it." The `relink` path in `applyPage` sets `lastPushedAt: null` on
  purpose. **Do not change the relink upsert.**
- "In `onConflictDoUpdate`, `` sql`excluded.x` `` needs the snake_case DB column name"
  (`excluded.last_pushed_at`, not `excluded.lastPushedAt`).
- Sync loops swallow per-item failures but always rethrow `GoogleRevokedError`.
- Branch on `GoogleApiError` helpers (`.isGone`), never on raw status.
- Comments explain why, in the existing register. The comment block above
  `pushPending` must be rewritten to describe the new three-way selection.

## Commands you will need

| Purpose   | Command             | Expected on success |
| --------- | ------------------- | ------------------- |
| Format    | `npm run format`    | exit 0              |
| Typecheck | `npm run typecheck` | exit 0              |
| Lint      | `npm run lint`      | exit 0              |
| Tests     | `npm run test`      | all pass            |
| Build     | `npm run build`     | exit 0              |

## Scope

**In scope**:

- `src/lib/sync/push.ts`
- `src/lib/sync/engine.ts`: only `purgeTombstones` and the `live` links upsert in `applyPage`

**Out of scope** (do NOT touch):

- `src/lib/sync/payload.ts` (`isPushable` is correct).
- The `relink`, `dead` and `movedOut` blocks in `applyPage`.
- `reconcile.ts`.
- Pushing deletions of **recurring instances**. That is deliberately deferred
  (see the comment at `push.ts:30-38`) and must stay excluded.
- Any schema change or new index.
- A per-connection sync lock. That is a separate finding (see `plans/README.md` backlog).

## Git workflow

- Branch: `advisor/003-push-sweep-selection`
- Commit style: plain imperative sentence, e.g. "Sweep only what still needs pushing".
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Make `pushEvent` prefer the live link and refuse to recreate a retired one

Replace the single-link lookup with a lookup of **all** links for
`(localEventId = eventId, gcalCalendarId = connection.gcalCalendarId)`, no `.limit`:

```ts
const live = links.find((l) => l.deletedAt === null) ?? null;
const retired = links.some((l) => l.deletedAt !== null);
```

Then:

- Withdrawal branch: use `live`. If `!live`, return `"skipped"` (same as today's `!link || link.deletedAt`).
- Edit branch: if `live`, PATCH it (unchanged logic).
- Before `insertEvent`: if `retired`, return `"skipped"`, with a why-comment:
  a retired link means Google no longer holds this event on purpose (deleted
  there, or withdrawn by us), and inserting would undo that.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Resolve the connection and token once per sweep

Give `pushEvent` an optional third parameter, `target?: Writable | null`. When
it is `undefined`, call `writableConnection(userId)` exactly as today. When the
sweep passes it, use it. Keep `pushEventBestEffort(userId, eventId)` unchanged,
so it passes nothing.

In `pushPending`, call `writableConnection(userId)` once before the query. If
it returns `null`, return the zeroed tally immediately. Nothing can be pushed,
and today every selected row pays for discovering that. Otherwise pass the
target into each `pushEvent` call.

Access tokens last ~1 hour. A 50-row sweep lasts well under 60s, so reusing one
token per sweep is safe.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Rewrite the `pushPending` selection

Keep the left join to the **live** link. Replace the `where` with three
disjoint cases, all under `eq(events.userId, userId)`:

```ts
or(
  // Never pushed: a live block of ours with no link of any kind.
  and(
    isNull(events.deletedAt),
    eq(events.origin, "local"),
    isNull(events.recurringEventId),
    notExists(
      db.select({ one: sql`1` }).from(eventLinks).where(eq(eventLinks.localEventId, events.id)),
    ),
  ),
  // Changed since the last push, or a won conflict (`last_pushed_at` cleared).
  and(
    isNull(events.deletedAt),
    eq(events.origin, "local"),
    isNull(events.recurringEventId),
    isNotNull(eventLinks.gcalEventId),
    or(isNull(eventLinks.lastPushedAt), lt(eventLinks.lastPushedAt, events.updatedAt)),
  ),
  // A withdrawal Google has not confirmed yet, whichever side created the event.
  and(
    isNotNull(events.deletedAt),
    isNull(events.recurringEventId),
    isNotNull(eventLinks.gcalEventId),
  ),
),
```

Add `.orderBy(asc(events.updatedAt))` before `.limit(limit)`, so the oldest
outstanding work goes first and nothing can starve behind newer rows. Import
`asc` and `notExists` from `drizzle-orm`. Both are exported by the installed
version; check with
`grep -n "export declare function notExists\|export declare function asc" -r node_modules/drizzle-orm/sql/`.

Rewrite the JSDoc above `pushPending` to describe the three cases and why dead
rows (tombstones already withdrawn, recurring instances, retired links) are
excluded rather than selected and skipped.

**Verify**:

- `npm run typecheck && npm run build` → exit 0
- `grep -n 'eq(events.origin, "local")' src/lib/sync/push.ts` → exactly 2 matches in `pushPending` (the withdrawal case has none)

### Step 4: Don't purge a tombstone whose withdrawal is still outstanding

In `engine.ts` `purgeTombstones`, add to the `and(...)`:

```ts
notExists(
  db
    .select({ one: sql`1` })
    .from(eventLinks)
    .where(and(eq(eventLinks.localEventId, events.id), isNull(eventLinks.deletedAt))),
),
```

Add a why-comment: purging cascades the link away, and a live link on a
tombstone means Google still holds the event, so the next full resync would
bring it back.

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Stop echoing pulled changes back to Google

In the `live` links upsert inside `applyPage` (the first `tx.insert(eventLinks)`,
**not** the `relink` one), add `lastPushedAt: now` to each value and
`lastPushedAt: sql\`excluded.last_pushed_at\``to the`set`. Add a why-comment:
this row now matches Google exactly, and leaving `last_pushed_at`behind the`updated_at` just written would make the sweep PATCH Google with what Google
just sent.

**Verify**:

- `npm run typecheck` → exit 0
- `grep -n "excluded.last_pushed_at" src/lib/sync/engine.ts` → exactly 1 match
- The `relink` upsert still contains `lastPushedAt: sql\`null\`` (`grep -n "lastPushedAt: sql\`null\`" src/lib/sync/engine.ts` → 1 match)

### Step 6: Full gate

**Verify**: `npm run format && npm run typecheck && npm run lint && npm run test && npm run build` → all exit 0.

## Test plan

- No DB fixture layer exists (by design; `CLAUDE.md` → Testing), and the
  changed logic is SQL predicates. Don't add a DB test harness.
- **Read-only probe (strongly recommended if `.env.local` exists):** create
  `probe.mts` in the repo root that imports `db` and the schema and runs
  **SELECT-only** versions of the old and new `pushPending` predicates for each
  `user_id` in `calendar_connections`. Print the counts side by side. Run with
  `npx tsx --conditions=react-server --env-file=.env.local probe.mts`.
  Expect new ≤ old. Report both numbers. **Never issue writes or call
  `pushPending` itself from the probe, and delete `probe.mts` afterwards.**

## Done criteria

- [ ] `grep -n "notExists" src/lib/sync/push.ts src/lib/sync/engine.ts` → matches in both files
- [ ] `grep -n "orderBy(asc(events.updatedAt))" src/lib/sync/push.ts` → 1 match
- [ ] `grep -n "excluded.last_pushed_at" src/lib/sync/engine.ts` → 1 match
- [ ] `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all exit 0
- [ ] `git status` shows only `src/lib/sync/push.ts`, `src/lib/sync/engine.ts`, `plans/README.md` modified; no `probe.mts`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `push.ts` doesn't match the excerpts above.
- `notExists` or `asc` isn't exported by the installed `drizzle-orm`.
- The probe shows the new predicate selecting **more** rows than the old one for any user.
- Satisfying a step seems to require changing `isPushable`, `reconcile.ts` or the `relink` upsert.

## Maintenance notes

- A withdrawal Google keeps refusing (e.g. a persistent 403 on an event the
  user is only invited to) will now be retried every sweep, and its tombstone
  is never purged. That is deliberate: it is visible, not silent. If it shows
  up in logs, handle it explicitly. Don't reuse `isForbidden` for this: it also
  matches 401, which means a token problem, not a refusal.
- If recurring-instance withdrawal is ever implemented (backlog item 7 in
  `docs/analysis/comparable-platforms.md`), the `isNull(events.recurringEventId)`
  in the withdrawal case is the line to revisit.
- If multi-calendar lands, the left join to "the live link" can return one row
  per calendar. Revisit the selection, and `Writable`, which assumes one writable calendar.
- Reviewer: diff the three cases against the old four-way `or` and confirm no
  legitimate case was dropped. The one intentional drop is "no live link but a
  retired link exists and the row is live", which is the recreate bug.
