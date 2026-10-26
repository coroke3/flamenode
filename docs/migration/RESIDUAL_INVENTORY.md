# Residual Worker / Cron / Queue / binding inventory

> MIG-0908 U01 / code-side snapshot (2026-10-26). **This is tracked configuration, not evidence of deployed production resources or traffic.**
>
> Source: `wrangler.toml` (7374334a), `workers/fast-jobs/wrangler.toml` (dd334fec), `workers/content-jobs/wrangler.toml` (e7177e02), `workers/sync-jobs/wrangler.toml` (387d5b08); corresponding `index.ts` inspected. Values such as 000... IDs are checked-in placeholders, **not real account identifiers**.
>
> Contract: MIG-0908 / D-15-14. U02 must make this table fail closed against every newly added declared cron, Queue or binding; U03 will propose the `/dev/ui-surfaces` disposition without deciding it.

## 1. Tracked code-side inventory

Every distinct `name`, `main`, cron expression, Queue producer/consumer and binding is a separate record. The **target owner** is a planned destination or CURRENT retained owner, **not a statement that a route/cutover has happened**. `未定` means ownership/retirement needs verification in MIG-0901.

| Config | Kind | Setting / binding | Value / resource | 移行後の担当（Worker / MIG） | 退役 MIG |
| --- | --- | --- | --- | --- | --- |
| `wrangler.toml` | worker.name | `name` | `flamenode-web` | `apps/site`, `apps/api`, `apps/app`, `apps/ops` (staged routes; **not cut over**) | MIG-0904 (after gates + approval) |
| `wrangler.toml` | worker.main | `main` | `.open-next/worker.js` | MIG-0904 (Next/OpenNext removal) | MIG-0904 |
| `wrangler.toml` | asset.binding | `ASSETS` | `.open-next/assets` | MIG-0904 (future static assets owner not yet confirmed) | MIG-0904 |
| `wrangler.toml` | service.binding | `WORKER_SELF_REFERENCE` | `flamenode-web` | MIG-0904 (OpenNext self service) | MIG-0904 |
| `wrangler.toml` | queue.producer | `NOTIFICATION_WAKE_QUEUE` | `flamenode-notification-wake` | `flamenode-fast-jobs` (consumer; future producer 未定) | 未定 |
| `wrangler.toml` | queue.producer | `STATIC_REBUILD_WAKE_QUEUE` | `flamenode-static-rebuild-wake` | MIG-0907 (legacy rebuild removal; new producer 未定) | MIG-0907 (legacy queue only; approval required) |
| `wrangler.toml` | queue.producer | `YOUTUBE_SYNC_WAKE_QUEUE` | `flamenode-youtube-sync-wake` | `flamenode-sync-jobs` (consumer; future producer 未定) | 未定 |
| `wrangler.toml` | d1.binding | `DB` | `flamenode_db` | D1 canonical / MIG-0904 legacy web binding | MIG-0904 (web binding only) |
| `wrangler.toml` | r2.binding | `BUCKET` | `flamenode-storage` | MIG-0904 legacy web binding; future owner 未定 | MIG-0904 (web binding only) |
| `wrangler.toml` | r2.binding | `NEXT_INC_CACHE_R2_BUCKET` | `flamenode-storage` | MIG-0904 U04 incremental cache | MIG-0904 |
| `wrangler.toml` | kv.binding | `KV` | checked-in placeholder ID | MIG-0904 legacy web binding; target 未定 | MIG-0904 (web binding only) |
| `workers/fast-jobs/wrangler.toml` | worker.name | `name` | `flamenode-fast-jobs` | CURRENT notification recovery/dispatch; replacement 未定 | 未定 |
| `workers/fast-jobs/wrangler.toml` | worker.main | `main` | `index.ts` | `flamenode-fast-jobs` retained pending MIG-0901 | 未定 |
| `workers/fast-jobs/wrangler.toml` | cron | `triggers.crons` | `0 * * * *` | `flamenode-fast-jobs` hourly recovery | 未定 |
| `workers/fast-jobs/wrangler.toml` | queue.producer | `NOTIFICATION_WAKE_QUEUE` | `flamenode-notification-wake` | `flamenode-fast-jobs` recovery wake | 未定 |
| `workers/fast-jobs/wrangler.toml` | queue.consumer | `flamenode-notification-wake` | DLQ `flamenode-notification-dlq`; batch 10; timeout 1; retry 3; delay 60; concurrency 1 | `flamenode-fast-jobs` dispatch | 未定 |
| `workers/fast-jobs/wrangler.toml` | d1.binding | `DB` | `flamenode_db` | `flamenode-fast-jobs` | 未定 |
| `workers/fast-jobs/wrangler.toml` | kv.binding | `KV` | checked-in placeholder ID | `flamenode-fast-jobs` | 未定 |
| `workers/content-jobs/wrangler.toml` | worker.name | `name` | `flamenode-content-jobs` | CURRENT rebuild/recovery/cleanup; post-MIG-0907 owner 未定 | 未定 |
| `workers/content-jobs/wrangler.toml` | worker.main | `main` | `index.ts` | `flamenode-content-jobs` pending MIG-0901 | 未定 |
| `workers/content-jobs/wrangler.toml` | cron | `triggers.crons` | `15 * * * *` | `flamenode-content-jobs` recovery/cleanup | 未定 |
| `workers/content-jobs/wrangler.toml` | queue.producer | `STATIC_REBUILD_WAKE_QUEUE` | `flamenode-static-rebuild-wake` | MIG-0907 legacy static rebuild; other jobs retained | MIG-0907 (queue only) |
| `workers/content-jobs/wrangler.toml` | queue.consumer | `flamenode-static-rebuild-wake` | DLQ `flamenode-static-rebuild-dlq`; batch 10; timeout 1; retry 3; delay 60; concurrency 1 | MIG-0907 (legacy queue removal) | MIG-0907 (approval required) |
| `workers/content-jobs/wrangler.toml` | d1.binding | `DB` | `flamenode_db` | `flamenode-content-jobs` pending MIG-0901 | 未定 |
| `workers/content-jobs/wrangler.toml` | r2.binding | `R2` | `flamenode-storage` | `flamenode-content-jobs` pending MIG-0901 | 未定 |
| `workers/content-jobs/wrangler.toml` | kv.binding | `KV` | checked-in placeholder ID | `flamenode-content-jobs` pending MIG-0901 | 未定 |
| `workers/sync-jobs/wrangler.toml` | worker.name | `name` | `flamenode-sync-jobs` | CURRENT YouTube/score/GA4/playlist sync; future 未定 | 未定 |
| `workers/sync-jobs/wrangler.toml` | worker.main | `main` | `index.ts` | `flamenode-sync-jobs` pending MIG-0901 | 未定 |
| `workers/sync-jobs/wrangler.toml` | cron | `triggers.crons` | `7,52 * * * *` | `flamenode-sync-jobs` metadata/score (:07), playlist (:52) | 未定 |
| `workers/sync-jobs/wrangler.toml` | queue.producer | `YOUTUBE_SYNC_WAKE_QUEUE` | `flamenode-youtube-sync-wake` | `flamenode-sync-jobs` | 未定 |
| `workers/sync-jobs/wrangler.toml` | queue.producer | `STATIC_REBUILD_WAKE_QUEUE` | `flamenode-static-rebuild-wake` | MIG-0907 legacy static rebuild | MIG-0907 (queue only) |
| `workers/sync-jobs/wrangler.toml` | queue.producer | `NOTIFICATION_WAKE_QUEUE` | `flamenode-notification-wake` | `flamenode-fast-jobs` (consumer) | 未定 |
| `workers/sync-jobs/wrangler.toml` | queue.consumer | `flamenode-youtube-sync-wake` | DLQ `flamenode-youtube-sync-dlq`; batch 10; timeout 1; retry 3; delay 300; concurrency 1 | `flamenode-sync-jobs` | 未定 |
| `workers/sync-jobs/wrangler.toml` | d1.binding | `DB` | `flamenode_db` | `flamenode-sync-jobs` | 未定 |
| `workers/sync-jobs/wrangler.toml` | r2.binding | `R2` | `flamenode-storage` | `flamenode-sync-jobs` pending MIG-0901 | 未定 |
| `workers/sync-jobs/wrangler.toml` | kv.binding | `KV` | checked-in placeholder ID | `flamenode-sync-jobs` pending MIG-0901 | 未定 |

**Counts (tracked source only):** 4 Worker names + 4 entrypoints, 3 cron *expressions* (4 schedule slots/hour), 8 Queue producer bindings, 3 Queue consumers with 3 DLQs, 4 D1 bindings, 4 R2 bindings, 4 KV bindings, 1 asset binding and 1 service binding. The queue name alone is not a dedicated consumer for every producer: compare each row by config + kind + binding. Consumer declarations also record batch size, timeout, retry count, retry delay, and concurrency to prevent silent configuration drift.

**Tracked-template safety:** `scripts/check-residual-inventory.mjs` requires placeholder `database_id`, KV `id` and KV `preview_id` values in these checked-in templates. A non-placeholder value fails the CI gate with a redacted diagnostic; real account identifiers belong only in the separately verified generated deployment config. Unknown binding sections/keys fail closed until MIG-0908 explicitly audits and registers them. This safeguard checks checked-in source, not secrets or remote Cloudflare state.

**Boundaries:** This is an inventory of declarative `wrangler.toml` entries, not runtime secret bindings, generated production config, Cloudflare account inventory, Queue deletion authority, traffic observations or idle/unused proof. The tracked `[vars]` values are not secret evidence. No Worker, Cron, Queue, Route, D1, R2, KV or account was altered.

### U03 — DEV_ONLY `/dev/ui-surfaces`: decision options, not a cutover

**CURRENT evidence:** `app/(public)/dev/ui-surfaces/page.tsx` is a Next.js preview of personal/settings form styles. It exports `dynamic = "force-dynamic"` and `metadata.noIndex = true`, and returns `notFound()` when `process.env.NODE_ENV === "production"`. The file imports CURRENT Next/React and CSS modules; this is a manual visual test surface, not a public product screen. The canonical `docs/migration/CURRENT_ROUTES.md` categorizes it as `DEV_ONLY`, and `docs/migration/UI_REFERENCE.md` explicitly says `DEV_ONLY` must not be promoted to production visual surfaces. `docs/migration/FILE_MIGRATION_MATRIX.md` retains the row under `MIG-0901`, state `NOT_STARTED`, target `RETAIN/REVIEW in MIG-0901`. Do not claim that it is already migrated or deleted.

**Option A — no public route migration (recommended proposal, not approved):** preserve the existing development-only inspection capability in a separate local/private development preview or component harness, without creating an Astro `/dev/ui-surfaces` page or public build artifact. After actual Phase 7 component parity is proven, the owner can separately decide whether to retain a dev-only harness or eliminate the obsolete preview. The **production request must continue to resolve as 404**, including when static/gateway fallback routes are used. `noIndex` alone is insufficient because it does not deny requests. Do not prematurely delete the CURRENT page while Next is the rollback target.

**Option B — port the visual inspection surface to Astro/React in development only:** use explicit build-time exclusion from production static output **and** a gateway/asset-path deny rule for the request path, with a regression test for both the production build artifact and actual request behavior. This is not authorized merely by adding `noindex`, hiding a navigation link, or relying on the browser's NODE_ENV. A shared Worker Route, wildcard/static fallback or direct asset access could otherwise expose it. Any resulting component preview should avoid production user data and authentication assumptions.

| Item | CURRENT | Option A — exclude public route | Option B — dev-only Astro preview | Decision owner |
| --- | --- | --- | --- | --- |
| Public `/dev/ui-surfaces` behavior | 404 in production via `notFound()` | Keep 404; do not emit static page | Keep 404 via artifact exclusion + request guard | MIG-0901 human Gate |
| Local visual preview | Next component/form CSS preview | Retain safely while needed or use separate harness | Recreate preview only in dev build | MIG-0901 human Gate |
| New code / Route today | None | None | None until separately approved | MIG-0901 |
| Verification required before removal | Current dev-page access + prod 404 | Gateway 404 + absence of public assets + safe fallback | Same, plus dev-only preview functionality | MIG-0901 / later rollout |
| Rollback | Existing Next page | Keep unchanged until retire Gate | Retain until parity and independent review | MIG-0901 |

**Recommendation for the future Gate:** select Option A unless an ongoing design/QA owner demonstrates that development-only Astro parity for this exact route is necessary. Evidence required for approval: route-map/static-artifact inspection, static fallback behavior, representative production-mode request returning 404, no public asset exposure, and a retained local visual QA route or an explicit decision that it is no longer required. At this checkpoint, **no selection/retirement/Route change is approved**, and MIG-0901 keeps the authoritative disposition.

## 2. Production traffic and usage observation — MIG-0901 only

Not started. Read production request/log/account evidence **only** under the separate MIG-0901 authorization/gates. This file does not establish that any live resource is unused, deployed, or safe to retire.
