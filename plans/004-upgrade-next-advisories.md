# Plan 004: Next.js is past the critical image-optimizer advisory, and CI runs the tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2f44196..HEAD -- package.json package-lock.json next.config.ts .github/workflows/ci.yml`
> If `next` in `package.json` is already `16.3.6` or later, skip Steps 1–2 and
> go to Step 3.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED — a minor-version framework bump; the full gate plus a smoke run is the safety net
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2f44196`, 2026-09-24

## Why this matters

`npm audit --omit=dev` reports a **critical** advisory against the installed
`next@16.2.12`: unauthenticated remote code execution in the Image Optimization
API when AVIF files are involved. Next's bundled `sharp` and `postcss` add
high-severity advisories. The app never imports `next/image`, but the
`/_next/image` endpoint is on by default and deliberately bypasses the auth
proxy, so anyone on the internet can reach it. The patched release is
`16.3.6`, with a matching `eslint-config-next@16.3.6`. Separately, CI never runs
`npm run test`. The 309 unit tests (sync reconciliation, grid math, crypto) only
run when someone remembers to run them locally.

## Current state

- `package.json` pins exact versions: `"next": "16.2.12"` (dependencies) and
  `"eslint-config-next": "16.2.12"` (devDependencies). Keep the pins exact, with no `^`.
- `next.config.ts` — no `images` key today:

  ```ts
  const nextConfig: NextConfig = {
    experimental: {
      /** ...long comment about staleTimes... */
      staleTimes: { dynamic: 90 },
    },
  };
  ```

- `src/proxy.ts:24` — the matcher excludes `_next/image` from auth, as it must.
  **Leave it alone.**
- `grep -rn "next/image" src` → no matches (verified at planning time).
- `.github/workflows/ci.yml` runs, in order: `npm ci`, `npm run format:check`,
  `npm run lint`, `npm run typecheck`, `npm run build`. **No `npm run test`.**
- `package.json` also has an `"allowScripts"` block listing exact versions of
  `esbuild`, `sharp` and `unrs-resolver` that may run install scripts. A `next`
  bump may pull a new `sharp` version. If `npm install` then refuses or warns
  that a script was blocked, add the new exact `sharp@<version>` entry next to
  the old one and remove the old one.
- `@blocknote/*` is pinned to `0.52.1` and pulls `@tiptap/core@3.29.2`, which
  also has a high advisory. **Out of scope here**: BlockNote is 0.x and pinned
  on purpose (`CLAUDE.md`: "BlockNote is pinned exact (0.x semver)"), and a bump
  needs its own editor regression pass.

## Commands you will need

| Purpose   | Command                                                                                | Expected on success                      |
| --------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| Install   | `npm install next@16.3.6 eslint-config-next@16.3.6 --save-exact`                       | exit 0                                   |
| Audit     | `npm audit --omit=dev`                                                                 | no `critical`; no advisory naming `next` |
| Full gate | `npm run format && npm run typecheck && npm run lint && npm run test && npm run build` | all exit 0                               |

## Scope

**In scope**:

- `package.json`, `package-lock.json`
- `next.config.ts` (add `images.unoptimized` only)
- `.github/workflows/ci.yml` (add one step)

**Out of scope**:

- `@blocknote/*` and `@tiptap/*` versions.
- `npm audit fix --force`, and any other bulk upgrade of unrelated packages.
- `src/proxy.ts`.
- Removing `zustand` / `googleapis`, even though they are unused. That's a
  separate cleanup, and `CLAUDE.md` documents them.

## Git workflow

- Branch: `advisor/004-upgrade-next-advisories`
- Commit style: plain imperative sentence, e.g. "Move Next to 16.3.6 and turn off the unused image optimizer", then "Run the tests in CI".
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Bump Next and its ESLint config

Run `npm install next@16.3.6 eslint-config-next@16.3.6 --save-exact`.

**Verify**:

- `node -e "console.log(require('./package.json').dependencies.next, require('./package.json').devDependencies['eslint-config-next'])"` → `16.3.6 16.3.6`
- `npm ls next` → a single `next@16.3.6`, no `invalid`

### Step 2: Turn off the image optimizer the app doesn't use

In `next.config.ts`, add a top-level `images: { unoptimized: true }` next to
`experimental`, with a short why-comment in the file's register: nothing
imports `next/image`, and the optimizer endpoint bypasses auth, so leaving it
on is attack surface with no benefit.

**Verify**: `grep -rn "next/image" src` → still no matches. If there **is** a
match now, STOP.

### Step 3: Run the unit tests in CI

In `.github/workflows/ci.yml`, add `- run: npm run test` directly after
`- run: npm run typecheck` and before `- run: npm run build`.

**Verify**: `grep -n "npm run test" .github/workflows/ci.yml` → 1 match, on the line after `npm run typecheck`.

### Step 4: Full gate and audit

**Verify**:

- `npm run format && npm run typecheck && npm run lint && npm run test && npm run build` → all exit 0
- `npm audit --omit=dev` → no `critical` severity, and no advisory whose package is `next`. Record the remaining high/moderate list in your report. `@tiptap/core` is expected to remain.

### Step 5: Smoke run

Start the dev server (`npm run dev`) and load `http://localhost:3000/login`.

**Verify**: the login page renders with no error overlay and the dev server
logs no errors. If you have a signed-in session, also open
`/calendar/week/<today's date as YYYY-MM-DD>` and one `/pages/<id>`, and check
that the BlockNote editor mounts.

## Test plan

No new tests. The existing 309 unit tests, the build, and the smoke run are the
regression check, and CI enforces the tests from now on.

## Done criteria

- [ ] `package.json` has `"next": "16.3.6"` and `"eslint-config-next": "16.3.6"`
- [ ] `grep -n "unoptimized: true" next.config.ts` → 1 match
- [ ] `grep -n "npm run test" .github/workflows/ci.yml` → 1 match
- [ ] Full gate exits 0
- [ ] `npm audit --omit=dev` shows no critical
- [ ] `git status` shows only the in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `npm install` wants to change `@blocknote/*`, `react` or `react-dom` versions.
- The build or lint fails with errors that point to Next 16.3 API changes
  (e.g. a renamed config key, a proxy/middleware signature change). Report the
  error text rather than refactoring app code.
- `npm audit` still lists a `next` advisory at 16.3.6. A newer patch may be
  required: report it instead of picking a version yourself.

## Maintenance notes

- If `next/image` is ever adopted, remove `unoptimized: true` deliberately and
  add explicit `images.remotePatterns`. The comment added in Step 2 should say so.
- Follow-up, not done here: evaluate `@blocknote/*` 0.55.x for the `@tiptap/core`
  advisory, with a manual editor pass (nested lists, toggles, checklists,
  headings, the custom context menu).
