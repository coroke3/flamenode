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
npx wrangler deploy --dry-run --outdir /tmp/wr-site --config apps/site/wrangler.toml
npx wrangler deploy --dry-run --outdir /tmp/wr-api --config apps/api/wrangler.toml
npx wrangler deploy --dry-run --outdir /tmp/wr-app --config apps/app/wrangler.toml
node --test scripts/new-worker-smoke-list.test.mjs
node scripts/new-worker-smoke-list.mjs
```

Any dry-run requiring `wrangler login` or real Cloudflare IDs is a **STOP**,
not permission to configure an account or insert secrets. CI must never execute
`wrangler deploy` without `--dry-run`; do not run `wrangler secret put`.

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
