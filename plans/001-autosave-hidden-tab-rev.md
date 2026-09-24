# Plan 001: Hiding a tab mid-edit no longer locks the page into a false conflict

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2f44196..HEAD -- src/components/editor/use-body-autosave.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED — touches the one path that persists what a user types
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `2f44196`, 2026-09-24

## Why this matters

Every block and every standalone page autosaves through one hook. When the tab
is hidden with unsaved edits (alt-tab, switching apps on a phone, locking the
screen within ~800ms of typing), the hook sends those edits with
`navigator.sendBeacon`. The server accepts them and increments `body_rev`, but a
beacon gets no response, so the client's copy of the revision is never updated.
The **next** save sends the stale revision, the server answers 409, and the UI
shows "This page changed somewhere else. Nothing here is being saved". From then
on every save 409s, because the hook never updates its revision after a
conflict. Nobody else touched the page. The fix is to send hidden-tab
saves with `fetch(..., { keepalive: true })`. Like a beacon it survives the page
unloading, but it also returns a response while the page lives, so the
revision can move forward.

## Current state

- `src/components/editor/use-body-autosave.ts` — the hook. Used by
  `src/components/editor/event-drawer.tsx:264` (blocks) and
  `src/app/(app)/pages/[id]/page-detail.tsx:170` (pages, with `basePath: "/api/pages"`).
- `src/app/api/events/[id]/body/route.ts` and `src/app/api/pages/[id]/body/route.ts` —
  the POST handlers. Each does `UPDATE ... SET body_rev = body_rev + 1 WHERE body_rev = baseRev`
  and returns `{ bodyRev }` on success or 409 `{ error: "conflict", current }`.
  **These routes are correct and are out of scope.**

The save loop (`use-body-autosave.ts:51-103`), which updates `revRef` from every response:

```ts
  const flush = useCallback(async () => {
    if (inFlightRef.current) return;
    clearTimers();
    if (pendingRef.current === null) return;

    inFlightRef.current = true;
    try {
      while (pendingRef.current !== null) {
        const body = pendingRef.current;
        pendingRef.current = null;
        setState("saving");

        const response = await fetch(`${basePath}/${eventId}/body`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body, baseRev: revRef.current }),
        });
        ...
        const { bodyRev } = (await response.json()) as { bodyRev: number };
        revRef.current = bodyRev;
      }
```

The beacon path (`use-body-autosave.ts:126-157`), which never updates `revRef`:

```ts
const beacon = useCallback(() => {
  const body = pendingRef.current;
  if (body === null) return;
  pendingRef.current = null;
  navigator.sendBeacon(
    `${basePath}/${eventId}/body`,
    new Blob([JSON.stringify({ body, baseRev: revRef.current })], { type: "application/json" }),
  );
}, [basePath, eventId]);

useEffect(() => {
  function onHidden() {
    if (document.visibilityState === "hidden") beacon();
  }
  document.addEventListener("visibilitychange", onHidden);
  return () => document.removeEventListener("visibilitychange", onHidden);
}, [beacon]);

useEffect(() => {
  return () => {
    clearTimers();
    beacon();
  };
}, [beacon, clearTimers]);
```

There is a second hazard in the same place. If the tab hides while a `flush` is
in flight, the beacon sends the _newer_ pending body with the _old_ revision.
The in-flight save lands first, so the beacon 409s on the server and those
edits are silently lost.

Browser facts the fix relies on:

- `fetch(url, { keepalive: true })` outlives the page like `sendBeacon`, and
  resolves normally if the page is still alive.
- keepalive request bodies are capped at 64 KiB in total per page, and so is
  `sendBeacon`. The routes accept up to 2,000,000 characters, so a large body
  sent with keepalive would be rejected by the browser. Use keepalive only when
  the serialised payload is under 60,000 bytes; otherwise send a normal fetch,
  which is still better than a beacon the browser would refuse.

Conventions: comments explain _why_, not what, and match the existing register.
Read the comments already in this file and match their tone. No new
dependencies. The React Compiler lint forbids `setState` inside effect bodies and
ref writes during render. Writing refs inside callbacks and event handlers
(which this file already does) is fine.

## Commands you will need

| Purpose   | Command             | Expected on success     |
| --------- | ------------------- | ----------------------- |
| Format    | `npm run format`    | exit 0 (rewrites files) |
| Typecheck | `npm run typecheck` | exit 0, no errors       |
| Lint      | `npm run lint`      | exit 0, no errors       |
| Tests     | `npm run test`      | all pass (309+ tests)   |
| Build     | `npm run build`     | exit 0                  |

## Scope

**In scope** (the only file you should modify):

- `src/components/editor/use-body-autosave.ts`

**Out of scope** (do NOT touch):

- Both `body/route.ts` handlers. The server-side revision check is correct.
- `event-drawer.tsx`, `page-detail.tsx`. Their conflict banners are correct for
  _real_ conflicts.
- Recovering from real conflicts (e.g. auto-merging). A 409 from a second tab
  must keep showing the banner exactly as today.

## Git workflow

- Branch: `advisor/001-autosave-hidden-tab-rev`
- Commit message style in this repo is a plain imperative sentence, no prefix,
  describing the user-visible effect. Examples from `git log`: "Let a deleted
  block stay deleted", "Keep open documents open, in a tab strip". Suggested:
  "Stop a hidden tab's save from locking the page as out of date".
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Let `flush` send with keepalive

Change `flush` to accept an optional `{ keepalive?: boolean }` argument. Store
the flag in a new ref, `keepaliveRef` (`useRef(false)`), and OR it in on every
call (`keepaliveRef.current ||= options?.keepalive ?? false`), **before** the
`inFlightRef` early return. That way a flush requested while a save is in
flight still upgrades the loop's later iterations to keepalive. Inside the
`while` loop, build the JSON payload string once, then:

```ts
const payload = JSON.stringify({ body, baseRev: revRef.current });
const response = await fetch(`${basePath}/${eventId}/body`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: payload,
  // Survives the page going away, as a beacon would, but still answers while
  // the page lives — which is what lets `revRef` follow the server.
  keepalive: keepaliveRef.current && payload.length < KEEPALIVE_LIMIT,
});
```

Add `const KEEPALIVE_LIMIT = 60_000;` near the other constants, with a
one-line why-comment (the browser caps keepalive bodies at 64 KiB). Reset
`keepaliveRef.current = false` in the `finally` block.

Callers that pass no argument (`page-detail.tsx`, `event-drawer.tsx`, the
debounce and max-wait timers) must keep working unchanged. Make the parameter
optional and don't change the return type.

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Replace the beacon with a keepalive flush

Delete the `beacon` callback. In the `visibilitychange` handler, call
`void flush({ keepalive: true })` when `document.visibilityState === "hidden"`.
In the unmount cleanup, call `clearTimers()` and then
`void flush({ keepalive: true })`. Update the dependency arrays to `[flush]` and
`[clearTimers, flush]`.

Replace the old JSDoc on `beacon` with a comment on the visibility effect that
explains the trap this plan fixes: a beacon's response is unreadable, so the
revision it advanced was never learned, and the next save conflicted with
itself.

**Verify**:

- `grep -n "sendBeacon\|beacon" src/components/editor/use-body-autosave.ts` → no matches
- `npm run typecheck && npm run lint` → exit 0

### Step 3: Full gate

**Verify**: `npm run format && npm run typecheck && npm run lint && npm run test && npm run build` → all exit 0.

### Step 4: Manual check in the running app

Only if a browser and a signed-in dev session are available (`npm run dev`,
open a page under `/pages/<id>` or a block drawer). Otherwise skip, and say so
in your report.

1. Type a few characters, then within half a second switch to another browser
   tab. Wait 2s and switch back.
2. Type again and wait 2s.
3. Expected: the footer reads "Saved". No "changed somewhere else" banner.
   In DevTools → Network, every POST to `/body` returned 200.
4. Reload the page. The text from both bursts is present.

## Test plan

The hook has no unit tests: vitest runs in the node environment with no DOM or
React testing library (`vitest.config.ts` includes only `src/**/*.test.ts`).
Don't add a DOM test harness for this plan. Verification is the full gate
plus the manual check in Step 4.

## Done criteria

- [ ] `grep -rn "sendBeacon" src/` returns no matches
- [ ] `grep -n "keepalive" src/components/editor/use-body-autosave.ts` shows the fetch option and the limit constant
- [ ] `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all exit 0
- [ ] `git status` shows only `src/components/editor/use-body-autosave.ts` modified (plus `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `use-body-autosave.ts` no longer matches the excerpts above.
- The React Compiler lint rejects the ref writes. Report the exact rule and
  line; don't disable the rule.
- You find the 409 path is also hit when two genuinely separate tabs edit the
  same page, and you are tempted to "fix" that too. That behaviour is correct
  and out of scope.

## Maintenance notes

- If a save queue or offline support is ever added, it must keep the invariant
  this plan restores: **every request that can advance `body_rev` must have its
  response read, or the client must re-fetch the revision before its next write.**
- The 60,000-byte keepalive limit is per page, not per request, and in-flight
  keepalive requests count against it. Two editors open in one tab (unusual)
  could exceed it, in which case the browser rejects the fetch. That lands in
  the existing `catch`, which marks the state `error` but does **not** put the
  body back into `pendingRef`. The next keystroke re-sends the whole document,
  so this is recoverable, but it is a pre-existing gap. If you want to close it,
  do it in a separate change: restore `pendingRef.current ??= body` in the
  `catch`.
- Reviewer: check that a plain `flush()` (Escape to close the drawer, the
  unmount flush in `page-detail.tsx`) behaves exactly as before.
