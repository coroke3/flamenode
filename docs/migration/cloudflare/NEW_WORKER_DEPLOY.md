# MIG-0628 — Target Workers deployment preparation (NO deployment authorization)

> Status: IN_PROGRESS / Draft PR #426. This is a non-production, Git-tracked
> template and test plan, not a cutover command. The production topology in
> [TOPOLOGY.md](TOPOLOGY.md) and the root `wrangler.toml` remain authoritative.

## Separation from CURRENT

| Role | CURRENT production source | TARGET template | Entry point | Assets |
| --- | --- | --- | --- | --- |
| Public gateway | `flamenode-web` (OpenNext) | `apps/site/wrangler.toml` | `src/gateway/index.ts` | `dist`, `run_worker_first=true` |
| Hono API | `flamenode-web` Route Handlers | `apps/api/wrangler.toml` | `src/index.ts` | none |
| Personal SPA | `flamenode-web` Next pages | `apps/app/wrangler.toml` | assets-only | `dist`, SPA fallback |
| Manage/Admin SPA | `flamenode-web` Next pages | **not in MIG-0628** (MIG-0704) | — | — |

The three Worker names are explicitly isolated: `flamenode-public-gateway`,
`flamenode-hono-api`, and `flamenode-personal`. They must never silently
become `flamenode-web` (the CURRENT production Worker) or each other's names.
The gateway `AUTH_ORIGIN` service target remains exactly `flamenode-web`
until the separately approved authentication migration. CI verifies these
root TOML names and the service's table-scoped target; dry-run alone cannot
prove name isolation or the correct authentication dependency.

All target templates retain CURRENT `compatibility_date=2026-07-21`
and `nodejs_compat`, `global_fetch_strictly_public`. Resource IDs are
**intentionally invalid placeholders**; there are no Route, Custom Domain,
OAuth credential, JWT or secret values in the tracked files.

## Binding inventory (U01)

| Worker | Binding | Type | CURRENT counterpart | Owner action before cutover |
| --- | --- | --- | --- | --- |
| gateway | ASSETS | Static Assets, Worker-first | CURRENT web ASSETS | versioned public Astro build; verify asset paths and 404 |
| gateway | R2_STORAGE | R2 | CURRENT web BUCKET, content-jobs R2 | approved resource mapping; no reads during dry-run |
| gateway | VISIBILITY_KV | KV | CURRENT KV (public revocation markers) | approved binding; separate alias for visibility |
| gateway | KV | KV | CURRENT web KV (operation mode mirror) | approved namespace mapping |
| gateway | DB | D1, only queue consumer | CURRENT web DB | owner migration and name/ID reconciliation |
| gateway | AUTH_ORIGIN | service binding | CURRENT flamenode-web (Auth.js) | verify origin service, HTTP cookie parity, no fake 404 |
| gateway | REBUILD_QUEUE | optional producer, nonprod only | CURRENT static-rebuild-wake queue | **not configured** in tracked template; gated by MIG-0411 |
| gateway | NEXT_PUBLIC_SITE_URL, AUTH_URL | public vars | CURRENT production canonical origin | owner verify actual public origins |
| gateway | MAINTENANCE_MODE | public var | CURRENT operation mode override | owner verify mode toggling |
| gateway | PUBLIC_PAGE_STYLESHEETS | public var, optional | MIG-0411 queue output | inject from build if enabling queue render |
| API | DB | D1 | CURRENT web DB | owner-approved id; local benchmark before launch |
| API | BUCKET | R2 | CURRENT web BUCKET | owner-approved resource |
| API | KV | KV | CURRENT web KV | owner-approved id |
| API | AUTH_SECRET | **secret (absent)** | CURRENT auth-related secret | explicit owner secret binding (name only in docs) |
| API | WORKER_ADMIN_TOKEN | **secret (absent)** | CURRENT admin token | explicit owner secret binding (name only in docs) |
| API | BUILD_COMMIT_SHA | build variable | CURRENT production deploy commit | must replace UNVERIFIED_DRY_RUN_ONLY at deploy |
| API | PUBLIC_VISIBILITY_GUARD_MODE, FORCE_STATIC_ONLY, YOUTUBE_DAILY_QUOTA_LIMIT | public vars | CURRENT runtime policy | owner inspect before enabling |
| API | NEXT_PUBLIC_SITE_URL, FLAMENODE_LOCAL_PREVIEW | public vars | CURRENT origin validation | preview forced off outside local dev |
| API | ADMIN_SPREADSHEET_ENABLED, ADMIN_SPREADSHEET_PAGE_SIZE | public vars | CURRENT admin ops flags | admin endpoint remains disabled by default |
| Personal | Static Assets only | assets-only, SPA fallback | CURRENT (auth) pages | enforce no-cache for dashboard/onboarding from public/_headers |
| Personal | D1/R2/KV/secret | **none** | provided only by API | do not inject into browser bundle |

The gateway `AUTH_ORIGIN` service continues to point at CURRENT Auth.js
until MIG-0805. Do not invent a new auth provider in this task.

## Non-production verification (U03, U04)

Run only inside checkout / CI; these do **not** upload assets or create resources:

```bash
npm ci --no-audit --no-fund
npm run build --workspace=@flamenode/contracts
npm run build --workspace=@flamenode/domain
npm run build --workspace=@flamenode/ui
npm run build --workspace=@flamenode/site
npm run build --workspace=@flamenode/app
npm run build --workspace=@flamenode/api
node --test scripts/new-worker-smoke-list.test.mjs scripts/new-worker-dry-run.test.mjs
node scripts/new-worker-dry-run.mjs --plan
node scripts/new-worker-smoke-list.mjs
node scripts/new-worker-dry-run.mjs
```

The auditable `scripts/new-worker-dry-run.mjs` wrapper internally runs only
the three fixed `wrangler deploy --dry-run` commands. It executes the locally
installed `node_modules/wrangler/bin/wrangler.js` with `process.execPath`,
using a non-shell argument vector on all platforms (including Windows).
It fails closed if the installed CLI is missing; no `npx.cmd`, package install,
login or production deploy fallback is allowed. Before invoking Wrangler, the
wrapper validates the **entire** three-Worker invocation plan (Worker names,
config files, build paths, Node executable, exact argument sequence and count).
Extra `--env`, `--route`, `--name`, replacement config, reordered Workers
and relative output directories are rejected, even when `--dry-run` remains
present. Before the local CLI starts, Cloudflare token/API key/account ID
environment variables are removed **from the child process only**; stdin is
disabled and unexpected hangs time out after four minutes. These controls do
not authorize connecting to a live Cloudflare account or deploying Workers.
This is a fail-closed plan gate, not a production deploy interface.
CI has an anti-deployment test that forbids
placing direct Wrangler deploy commands in GitHub Actions YAML; this rule is
preserved, not weakened. `--plan` never invokes any external command.

Any dry-run requiring `wrangler login` or real Cloudflare IDs is a **STOP**,
not permission to configure an account or insert secrets. CI must never execute
`wrangler deploy` without `--dry-run`; do not run `wrangler secret put`.

### Smoke-plan execution safety (U04)

`node scripts/new-worker-smoke-list.mjs` **only prints JSON**: it does not issue HTTP requests.
Only fixed-path `GET`/`HEAD` endpoints may be marked `candidate`, and even those
require an owner-verified response/authentication contract before execution.
All `POST`/`PUT`/`PATCH`/`DELETE` methods and parameterized paths are
`fixture-required`, including endpoints named `dry-run`. So are GET/HEAD
routes documented with query parameters and all `/api/personal`,
`/api/admin`, `/api/admin-read`, `/api/manage`, and `/api/account`
read paths: these need test identities and explicit expected 401/403/200
contracts, not unauthenticated automatic requests. A query shorthand such as
`/api/personal/library?tab&page` is represented by the canonical pathname
`/api/personal/library` plus a fixture flag; it is never silently excluded.
The bracketed `/api/live/events/[id]/{slots,submissions,summary}` shorthand
is deliberately omitted and replaced by three verified Hono `/:id/...`
routes, each requiring an event fixture. Never replay mutation probes against
live production data merely from this checklist.
The `/api/health/deep` endpoint is **not** a public health probe: it
requires `WORKER_ADMIN_TOKEN` for authorization and currently fails closed
(401 with an invalid Bearer token, 503 without a configured token or while
deep-health parity is incomplete). It must be validated with owner-controlled
fixtures, not counted as a public 200 smoke success. The `React/Vite app`
route group is authenticated/private and excluded entirely from
`publicSmoke`; only `Astro/site` paths and the three fixed public roots
enter that list.

An owner-run future smoke executor must explicitly require isolated fixtures,
credentials scoped to the test environment, and a separate authorization gate.

## Human-owned cutover and smoke chain (U05)

1. Require Phase 5–8 gates, a fresh independent review of these templates,
   both PR-head CI jobs green, final asset manifest/route/visibility parity,
   and a separately recorded explicit owner approval for each deploy/change.
2. Reconcile *actual* approved D1/KV/R2/Queue IDs and service bindings outside
   these tracked placeholder templates; secrets only via approved secret store.
   **Never commit rendered production configuration.**
3. Validate gateway `ASSETS` Worker-first, Auth.js `AUTH_ORIGIN` and health,
   PUBLIC_VISIBILITY_GUARD_MODE, all reserved private routes, no stale 404s,
   no cost guard bypass, and the generated smoke list.
4. Use the same verified `BUILD_COMMIT_SHA` across new Worker versions;
   compare `GET /api/health` commit to the expected Git commit as CURRENT
   smoke-cloudflare.mjs does. Mismatch blocks traffic routing.
5. **Owner-only, future**: deploy approved assets/workers, verify smoke on
   isolated preview host; only after explicit second approval switch domains/
   Routes. This document does not authorize or execute either operation.
6. Rollback: restore CURRENT `flamenode-web` domain ownership and verified
   prior Workers/asset versions. Run authenticated 401/403, 404/503, queue and
   health smoke before considering the rollback complete.

### STOP conditions

- Any unexpected real account/resource ID, non-placeholder KV/D1 ID,
  leaked secret, route/custom domain, paid tier operation or upload attempt.
- Wrangler asks for login during dry-run or fails because of credentials:
  stop, document and request owner assistance; do not retry remotely.
- Git SHA diverges, visibility revocation fails closed unexpectedly, or
  gateway serves authenticated/private data from a public asset.
