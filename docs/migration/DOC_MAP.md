# FlameNode Migration Documentation Map

> Status: Active / source-of-truth map
> Last verified: 2026-10-07

移行で同じ仕様を複数Markdownへ複製しないための正本マップ。**全表を毎回読むためのリストではない**。実装時の対象MIGと参照範囲は[MIGRATION_START_HERE.md](MIGRATION_START_HERE.md)を利用する。

## Canonical sources

| Topic | Canonical source |
| --- | --- |
| repo-wide agent rules / safety | `AGENTS.md` |
| task routing | `docs/AI_CONTEXT.md` |
| migration architecture / invariants / phases | `docs/migration/README.md` |
| cross-agent execution / loop semantics | `docs/migration/AGENT_PROTOCOL.md` |
| **small-context one-task entry** | `docs/migration/MIGRATION_START_HERE.md` |
| 1102 performance work order and dual-track Gate | `docs/migration/PERFORMANCE_IMPLEMENTATION_PLAN.md` |
| normalized route hot-path CPU evidence and migration owner | `docs/migration/PERF_HOTPATH_MATRIX.md` |
| document volume / sufficiency audit | `docs/migration/DOC_CONTEXT_AUDIT.md` |
| small-model single-task procedures | `docs/migration/IMPLEMENTATION_RUNBOOK.md` |
| large task resumable micro-unit work packet and PR checkpoints | `docs/migration/TASK_MICRO_UNITS.md` |
| per-file source/target progress and ownership | `docs/migration/FILE_MIGRATION_MATRIX.md` |
| per-file state machine and provider/consumer integration | `docs/migration/FILE_PROGRESS_PROTOCOL.md` |
| cross-framework provider→consumer dependency ordering | `docs/migration/FILE_DEPENDENCY_GRAPH.md` |
| verified 2026-10-09 source-code parity audit and corrections | `docs/migration/CODE_AUDIT_2026-10-09.md` |
| Phase 2–9 per-MIG executable cards | `docs/migration/TASK_CARDS_2_3.md` + `docs/migration/TASK_CARDS_4_5.md` + `docs/migration/TASK_CARDS_6_7.md` + `docs/migration/TASK_CARDS_8_9.md` |
| cross-model live smoke acceptance | `docs/migration/SMALL_MODEL_SMOKE_TEST.md` |
| migration Git / branch / PR / merge policy | `docs/migration/GIT_WORKFLOW.md` |
| migration code quality | `docs/migration/CODE_QUALITY.md` |
| current phase / task / owner / dependency state | `docs/migration/STATUS.md` |
| CURRENT page route実装・分類 | `docs/migration/CURRENT_ROUTES.md` |
| 既存機能の全件一覧（人間向け派生ビュー） | `docs/migration/FEATURE_CATALOG.md` |
| frontend observable capabilities | `docs/migration/FRONTEND_FEATURES.md` + `docs/migration/frontend/*.md` |
| CURRENT visual screen / compat / system / shell UX-FN mapping | `docs/migration/screen-mapping/README.md` |
| backend/domain/platform function parity | `docs/migration/FUNCTION_INVENTORY.md` + `docs/migration/functions/*.md` |
| existing design/product requirement reconciliation | `docs/migration/PRODUCT_REQUIREMENTS.md` |
| new UI visual source / HTML mock registration | `docs/migration/UI_REFERENCE.md` |
| UI component adapter / Next.js decoupling guide | `docs/migration/UI_MIGRATION_GUIDE.md` |
| Phase 1 task specification & design strategy | `docs/migration/PHASE_1_SPEC.md` |
| Phase 3 task specification (domain extraction) | `docs/migration/PHASE_3_SPEC.md` |
| D-01 DB schema extraction plan | `docs/migration/DB_PACKAGE_EXTRACTION_PLAN.md` |
| Phase 4 & 5 task specification (Astro SSG & Islands) | `docs/migration/PHASE_4_5_SPEC.md` |
| Phase 6 task specification (Hono API) | `docs/migration/PHASE_6_SPEC.md` |
| Phase 7 task specification (Private React SPA) | `docs/migration/PHASE_7_SPEC.md` |
| Phase 8 & 9 task specification (Auth & Retirement) | `docs/migration/PHASE_8_9_SPEC.md` |
| Active X data migration plan | `docs/migration/ACTIVE_X_MIGRATION_PLAN.md` |
| multi-worker routing and staged deployment plan | `docs/migration/ROUTING_AND_DEPLOY_PLAN.md` |
| adopted architectural decisions and separate PoC/approval gates | `docs/migration/OPEN_DECISIONS.md` |
| backend commonization / optimization / blocker assessment | `docs/migration/BACKEND_OPTIMIZATION.md` |
| route target/disposition | `docs/migration/ROUTE_MATRIX.md` |
| Server Action disposition | `docs/migration/server-actions/README.md` |
| Route Handler / API disposition | `docs/migration/route-handlers/README.md` + `docs/migration/API_MATRIX.md` |
| CURRENT Cloudflare Worker/ingress/binding/build topology | `docs/migration/cloudflare/TOPOLOGY.md` |
| CURRENT measured CPU / 1102 / request baseline | `docs/migration/cloudflare/PERFORMANCE_BASELINE.md` |
| CURRENT static artifact / alias / visibility / fallback baseline | `docs/migration/static-delivery/README.md` |
| CURRENT auth / session / identity / permission baseline | `docs/migration/auth/README.md` |
| CURRENT Queue / Cron / background jobs baseline | `docs/migration/background-jobs/README.md` |
| CURRENT public/static/visibility behavior | `docs/operations/static-delivery.md` + current code/tests |
| CURRENT UI behavior evidence | `docs/operations/ui-acceptance.md` + current code/tests |
| CURRENT DB schema (until MIG-0308) | `src/lib/db/schema.ts` + `migrations/` |
| TARGET DB schema (after MIG-0308) | `packages/db/src/schema/index.ts` + immutable `migrations/`; old schema bridge retained |
| CURRENT Worker config implementation evidence | `wrangler.toml`, `workers/*/wrangler.toml`, deploy scripts, actual Cloudflare settings |
| deploy procedure | `DEPLOY.md` |

## UI source rule

- `docs/design-redesign/` is removed and is not a migration source.
- `app/(redesign)` is not an authoritative target design.
- New visual/information-architecture target remains `UI_REFERENCE.md = PENDING_HTML` until the user supplies an HTML mock.
- HTML mock never overrides permission/business/visibility/side-effect contracts by itself.

## Rules

- Migration docs describe TARGET / transition / progress. CURRENT behavior remains code/test/config driven until cutover.
- `CURRENT_ROUTES.md` owns the 90 `app/**/page.tsx` classification baseline（74 VISUAL_SCREEN / 9 COMPAT_REDIRECT / 1 DEV_ONLY / 6 SYSTEM_SURFACE）。
- `FEATURE_CATALOG.md` is a human-readable derived view of all `UX-*` / `FN-*`; it never overrides the canonical ledgers.
- `FRONTEND_FEATURES.md` + `frontend/*.md` own `UX-*` frontend observable behavior.
- `screen-mapping/README.md` owns the resolved mapping from CURRENT visual/compat/dev/system surfaces + cross-route shells to UX/FN, permission/state/query/responsive-a11y contracts.
- `FUNCTION_INVENTORY.md` + `functions/*.md` own `FN-*` backend/domain/platform functions.
- `UX-*` and `FN-*` are intentionally many-to-many.
- `PRODUCT_REQUIREMENTS.md` owns reconciliation between current implementation and existing design intent.
- `BACKEND_OPTIMIZATION.md` owns optimization/blocker decisions.
- `cloudflare/TOPOLOGY.md` owns the verified CURRENT four-Worker / ingress / binding / build-deploy topology; Wrangler and Cloudflare APIs are its evidence surfaces.
- `cloudflare/PERFORMANCE_BASELINE.md` owns measured CURRENT CPU/resource-failure/request evidence and representative migration budgets.
- `static-delivery/README.md` owns CURRENT artifact families/commit-points, canonical alias rules, visibility fence ordering, fail-closed reads, degraded fallback and repair semantics.
- `auth/README.md` owns CURRENT Auth.js/session/linking/terms/Active X/event-video authorization/owner-invariant semantics.
- `background-jobs/README.md` owns CURRENT Queue doorbell/Cron/D1 work-state/retry/DLQ/recovery/idempotency/async-state semantics.
- `CODE_QUALITY.md` owns implementation quality standards.
- `STATUS.md` is the only progress/task-state source. Do not add `PROGRESS.md`/`WORK_ITEMS.md`.
- `GIT_WORKFLOW.md` is the only branch/PR/merge policy source.
- Do not duplicate exact schema columns, binding IDs, API fields, or long command lists across docs.
- If migration changes CURRENT production behavior, update the relevant Active CURRENT document in the same change before task DONE.
- Historical/archive docs are evidence, not current truth.
- Existing design documents can reveal missed requirements, but conflicts must be reconciled rather than silently applied.

## Active-document classification

- `canonical-current`
- `canonical-target`
- `requirement-reconciliation`
- `ui-reference`
- `task-router`
- `progress-ledger`
- `frontend-ux-ledger`
- `function-ledger`
- `optimization-ledger`
- `code-quality`
- `git-workflow`
- `generated/inventory`
- `historical`
- `duplicate -> <canonical path>`
- `stale-needs-fix`

Do not mass-rewrite docs for style. Optimize truth ownership, context size, verification, and agent handoff.