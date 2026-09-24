# Plan 006: An all-day event starts at midnight in its own zone on any server

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Do not improvise.
>
> **Drift check (run first)**: `git diff --stat 910f1a3..HEAD -- src/lib/sync/map.ts src/lib/sync/map.test.ts vitest.config.ts`
> If any file changed, compare it with the excerpts below. A mismatch is a STOP condition.

## Status

- **Priority**: P1 (CI on `main` is red because of it)
- **Effort**: S
- **Risk**: LOW. One pure function, covered by tests.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `910f1a3` on `main`, 2026-09-24

## Why this matters

`toInstant` in `src/lib/sync/map.ts` anchors a Google all-day event (a bare
`date`) to midnight in the event's zone like this:

```ts
if (value.date) {
  const parsed = new TZDate(`${value.date}T00:00:00`, tz);
  return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getTime());
}
```

`TZDate`'s **string** constructor parses the string in the machine's local
zone, not `tz`. Measured for `2026-07-29` with `tz = "Africa/Lagos"`
(correct: `2026-07-28T23:00:00.000Z`):

| machine TZ       | string form (today) | `new TZDate(2026, 6, 29, tz)` |
| ---------------- | ------------------- | ----------------------------- |
| UTC              | 2026-07-29T00:00Z ✗ | 2026-07-28T23:00Z ✓           |
| Africa/Lagos     | 2026-07-28T23:00Z ✓ | 2026-07-28T23:00Z ✓           |
| America/New_York | 2026-07-29T04:00Z ✗ | 2026-07-28T23:00Z ✓           |

Production (Vercel) runs on UTC. The existing test
`src/lib/sync/map.test.ts` ("anchors an all-day event to midnight in its own
zone, not UTC") is correct. It only passed because the maintainer's machine is
on Africa/Lagos. It fails in CI, which runs on UTC. The fix is to use the
numeric constructor, which interprets its components in `tz`.

A read-only check of production on 2026-09-24 found no stored rows affected:
every all-day row there has `tz = 'UTC'`. So no data backfill is needed.

The deeper lesson is that the test suite's result depends on the machine's
timezone. Pinning the tests to UTC makes a local run match CI and production.

## Scope

**In scope**: `src/lib/sync/map.ts` (`toInstant` only), `src/lib/sync/map.test.ts`, `vitest.config.ts`.

**Out of scope**: `payload.ts` (its `isoDate` uses `toLocaleDateString` with
an explicit `timeZone` and is correct), `engine.ts` (including the
`calendar.timeZone ?? "UTC"` fallback), any DB data.

Conventions: comments explain why, in the file's existing register. Use `@/`
imports. Prettier runs at 100 cols.

## Git workflow

Branch `advisor/006-all-day-midnight-in-zone`. Commit messages are plain
imperative sentences, e.g. "Anchor an all-day event to its own midnight on any
server". End each commit message with the line
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Steps

### Step 1: Pin the tests to UTC, and watch the bug appear

In `vitest.config.ts`, add at module top level, before `export default`:

```ts
// Tests run in the zone production runs in. A suite that passes only on the
// author's clock is how a zone bug in `map.ts` shipped: it read Lagos locally
// and UTC everywhere that mattered.
process.env.TZ = "UTC";
```

**Verify**: `TZ=Africa/Lagos npx vitest run src/lib/sync/map.test.ts` → exactly
1 failure, "anchors an all-day event to midnight in its own zone, not UTC".
This proves the config overrides the machine's zone. If it passes, STOP: the
override is not taking effect.

### Step 2: Fix `toInstant`

Replace the `value.date` branch with a parse of `YYYY-MM-DD` into numbers and
`new TZDate(year, month - 1, day, tz)`. Guard against a malformed date. If the
string doesn't match `/^(\d{4})-(\d{2})-(\d{2})$/`, return `null`, as today's
NaN check effectively does. Update the function's JSDoc with one sentence
explaining why: TZDate's string constructor reads the machine's zone, not `tz`.

**Verify**: `npx vitest run src/lib/sync/map.test.ts` → all pass.

### Step 3: Cover a zone west of UTC and a malformed date

In `map.test.ts`, following the existing all-day test's shape, add:

1. An all-day event on `2026-07-29` with calendar zone `America/New_York`.
   Expect start `2026-07-29T04:00:00.000Z` and end `2026-07-30T04:00:00.000Z`
   (EDT is UTC−4).
2. An all-day event whose `start.date` is `"not-a-date"`. Expect whatever
   `mapGoogleEvent` returns today when `toInstant` returns `null` (read the
   function to see what that is), and assert exactly that.

**Verify**: `npx vitest run src/lib/sync/map.test.ts` → all pass.
`TZ=America/New_York npm run test` → all pass.

### Step 4: Full gate

`npm run format && npm run typecheck && npm run lint && npm run test` → all exit 0.
Build with placeholder env (see the operator's instructions) → exit 0.

## Done criteria

- [ ] `grep -n 'T00:00:00`' src/lib/sync/map.ts` → no matches
- [ ] `grep -n 'process.env.TZ = "UTC"' vitest.config.ts` → 1 match
- [ ] `TZ=Africa/Lagos npm run test` and `TZ=UTC npm run test` both pass, with ≥ 321 tests
- [ ] Only the three in-scope files changed

## STOP conditions

- Step 1's check passes (the TZ override isn't taking effect).
- Any other test starts failing under UTC in Step 1. That is another
  zone-dependent bug. Report it instead of fixing it.

## Maintenance notes

- Any new date parsing should use `TZDate`'s numeric constructor or
  `@date-fns/tz` helpers, never its string constructor with a zone-less string.
- Separate question, not in this plan: every all-day row in production has
  `tz = 'UTC'`, while timed events carry `Africa/Lagos`. Either the Google
  calendar's zone setting is UTC, or `getCalendar` returns no `timeZone`. Worth
  checking in Google Calendar settings.
