# Plan 007: CI's build step runs without real secrets

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Do not improvise.
>
> **Drift check (run first)**: `git diff --stat 910f1a3..HEAD -- .github/workflows/ci.yml`

## Status

- **Priority**: P1 (CI on `main` has failed on every push since at least 2026-08-12)
- **Effort**: S
- **Risk**: LOW. CI config only.
- **Depends on**: none (plan 006 fixes the separate test-step failure)
- **Category**: DX
- **Planned at**: commit `910f1a3` on `main`, 2026-09-24

## Why this matters

`npm run build` fails in CI with `Missing required environment variable:
DATABASE_URL`. Next collects page data for route handlers at build time. That
imports `src/db/index.ts`, which reads `serverEnv.databaseUrl` at module load
(`src/env.ts` throws when it is missing). CI sets no env vars. Nothing connects
at build time: postgres-js only opens a connection on its first query. So
placeholder values are enough, and no real secrets belong in CI. Verified on
2026-09-24: the build exits 0 with the placeholders below.

## Scope

**In scope**: `.github/workflows/ci.yml` only.
**Out of scope**: `src/env.ts`, `src/db/index.ts` (making the pool lazy is a
bigger change, not needed), GitHub repository secrets.

## Git workflow

Branch `advisor/007-ci-build-env`. Commit message e.g. "Give the CI build
placeholder env, since nothing connects at build time". End it with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Steps

### Step 1: Add a step-level `env` to the build step

In `.github/workflows/ci.yml`, change `- run: npm run build` to:

```yaml
# Placeholders, not secrets. Route modules read env at import time and
# Next imports them while collecting page data, but nothing connects to
# a database or Google during a build.
- run: npm run build
  env:
    DATABASE_URL: postgres://build:build@127.0.0.1:1/build
    NEXT_PUBLIC_SUPABASE_URL: https://placeholder.invalid
    NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder
    SUPABASE_SERVICE_ROLE_KEY: placeholder
    NEXT_PUBLIC_APP_URL: https://placeholder.invalid
    GOOGLE_CLIENT_ID: placeholder
    GOOGLE_CLIENT_SECRET: placeholder
    TOKEN_ENCRYPTION_KEY: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
    CRON_SECRET: placeholder
```

The names must match `.env.example` exactly. Check with
`grep -o '^[A-Z_]*=' .env.example`. If `.env.example` lists a name not above,
add it with a placeholder value. If it lists fewer, STOP.

**Verify**: `npx prettier --check .github/workflows/ci.yml` → passes. Then run
the build locally with exactly these values as env vars → exit 0.

## Done criteria

- [ ] `grep -c "placeholder" .github/workflows/ci.yml` ≥ 5
- [ ] Local build with those values exits 0
- [ ] Only `ci.yml` changed

## STOP conditions

- The build fails with the placeholders for a reason other than a missing
  variable (e.g. something connects at build time). Report the error.

## Maintenance notes

- A new required env var must be added here as well as to `.env.example`, or
  CI goes red again with "Missing required environment variable".
