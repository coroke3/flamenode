# Feature Inventory / Parity Ledger

This ledger prevents framework/UI migration from deleting existing behavior. It is not a wishlist.

## Screen coverage baseline

The explicit screen list remains `docs/design-redesign/ROUTE_INVENTORY.md`:

| Category | Count | Migration surface |
| --- | ---: | --- |
| Public | 16 | Astro SSG + islands/API where needed |
| Personal | 6 | React SPA + Hono API |
| Entry | 3 | React SPA + Hono API |
| Manage | 12 | React SPA + Hono API |
| Admin | 45 | React SPA + Hono API |
| System | 4 | route-specific: static/system SPA/dev surface |
| **Total** | **86** | coverage count must never decrease silently |

Do not copy the 86-row route table here. A route is migration-ready only after its current behaviors are represented by verified feature rows below and its UI acceptance states are checked.

## Feature domains

`baseline` means source exists but behavior inventory is not yet exhaustive. `verified` requires code/test evidence and explicit parity behavior.

| ID | Domain | Current source starting points | Migration risk / must preserve | Audit |
| --- | --- | --- | --- | --- |
| F-PUB-VIDEO | public video detail | `app/(public)/[id]`, `src/lib/publicData/` | internal/YouTube aliases, SEO/OGP, chapters, event refs, interactions/overlay | baseline |
| F-PUB-DISCOVERY | home/list/recommend/trending | public pages, public loaders | filters, ordering, pagination/infinite scroll, empty/degraded behavior | baseline |
| F-PUB-USER | user/profile/portfolio | `app/(public)/user*` | listable X user policy, canonical id, portfolio ordering | baseline |
| F-EVENT | event/group/release | public event/group pages | public status, groups, release ordering, live state | baseline |
| F-SLOTS | public/manage slots | public slots + manage slot code/tests | reservation state, visibility, capacity, permission, mobile table behavior | baseline |
| F-ENTRY | slotted/unslotted entry | `app/(auth)/entry*` | duplicate prevention, submission constraints, auth/X identity, notifications | baseline |
| F-DASHBOARD | personal dashboard/library/edit | `app/(auth)/dashboard*` | private D1 path must never leak into public artifact/cache | baseline |
| F-VIDEO-PERM | video members/permissions | permission resolver + edit permission UI/tests | owner/member authority and write checks | baseline |
| F-MANAGE | event workspace | `app/(manage)` | staff/event permission, review, videos, audience, playlist, notification queues | baseline |
| F-ADMIN | admin console | `app/(admin)` | admin authorization, dangerous operation confirmations, table/search semantics | baseline |
| F-AUDIT | audit/history/restore | audit/restore Active doc + tests | actor, immutable audit trail, preview/restore safety | baseline |
| F-MODERATION | moderation | admin moderation code/tests | case priority/state transitions and authorization | baseline |
| F-XID | X ID/link/merge | auth/X-id code + manage/admin requests | active X ID, approval, linking/merge safety | baseline |
| F-YOUTUBE | metadata/playlist/sync/quota | YouTube workers/lib/admin | quota, ordering, sync failure/retry, alias mapping | baseline |
| F-NOTIFY | notifications | notification queues/workers/manage/admin | post-commit semantics, retry/DLQ, recipient safety | baseline |
| F-PUBLIC-API | public API/export/live | `app/api`, `src/lib/api`, contract tests | explicit DTO only, auth/visibility, polling semantics | baseline |
| F-STATIC | static public artifacts | `docs/operations/static-delivery.md`, `src/lib/publicData/` | R2/cache/degraded policy, no private rows, canonical aliases | baseline |
| F-VISIBILITY | public visibility fence | static-delivery doc + visibility transition/check tests | block before D1 transition, release_pending, CAS token, fail closed | baseline |
| F-AUTH | session/account/auth | `src/lib/auth`, NextAuth config/tests | DB session, adapter, linking, origin, role, banned, active X, callbacks/logging | baseline |
| F-JOBS | fast/content/sync + queue/recovery | `workers/`, queue docs/tests | queue ownership, retries/DLQ, static generation, sync isolation | baseline |
| F-DB | D1/schema/migrations | `src/lib/db/schema.ts`, `migrations/` | no rewrite of applied migration; atomic side effects and indexes | baseline |
| F-OPS | health/cost/static-build/worker ops | admin ops pages + operations docs | diagnostics, repair guards, cost/operation modes | baseline |

## Required evidence for `verified`

For each row record, directly in this table or a linked focused file:

1. current code path(s);
2. relevant test/check names;
3. user-visible states/actions;
4. authorization and visibility rules;
5. DB/R2/KV/Queue/external side effects;
6. failure/degraded behavior;
7. target owner: Astro static / island / SPA / Hono / worker / unchanged;
8. parity acceptance and rollback implication.

Unknown behavior is written as `unknown`; it is never inferred away. If implementation reveals a feature not in this ledger, add it before continuing the migration diff.
