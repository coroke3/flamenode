# FlameNode API / Server Migration Matrix

> Status: Active / Server migration source of truth
> Last updated: 2026-10-07
> Architecture: [`README.md`](README.md)
> Progress: [`STATUS.md`](STATUS.md)
> Function parity: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)
>
> Server Action / inline Server Action / Route Handler / server-only helperを、CURRENT contractを失わずframework-neutral domain service + Hono APIへ移すための契約表。

## Baseline tasks

- `MIG-0003`: 全Server Action export + page内inline actionを棚卸し
- `MIG-0004`: 全`app/api/**/route.ts`をHTTP method単位で棚卸し
- `MIG-0011`: function inventoryと突合し、未分類server capabilityを0にする

棚卸し前にHono endpointを先行量産しない。

## MIG-0003 result — Server Actions

CURRENT Server Actionsのfunction-level正本は [`server-actions/README.md`](server-actions/README.md)。

```text
34 "use server" modules
106 exported actions
4 inline actions
110 total execution units
unclassified = 0
```

TargetではServer ActionをHonoへcopyせず、framework-neutral domain serviceをlegacy adapterとHono adapterから共有する。

## MIG-0004 result — Route Handlers

CURRENT Route Handlerのmethod-level正本は [`route-handlers/README.md`](route-handlers/README.md)。

```text
app/api/**/route.ts files: 28
HTTP method handlers: 33
unclassified methods: 0
```

public/admin/internal/live/media/authを同じgeneric API層へ平坦化しない。HTTP envelopeは共通化しても、visibility・same-origin・operation-mode・media ACL/signature・Auth.js compatibilityの安全境界は明示的に維持する。

## Columns

- `CURRENT`: 現在のServer Action / Route Handler / helper
- `FUNCTION`: `FN-*` capability IDs
- `DOMAIN`: 移行先domain service
- `TARGET`: Hono endpointまたは継続job
- `Permission`: 維持する認可契約
- `Effects`: D1 / audit / Queue / R2/KV / notification / external等
- `State`: NOT_INVENTORIED / CURRENT_VERIFIED / MIGRATION_IN_PROGRESS / BRIDGED / PARITY_VERIFIED / BLOCKED
- `Task`: `STATUS.md`のMIG task

## Domain summary

以下は移行単位の初期分類。exact export/endpointはMIG-0003/0004でこの表へ追加する。

| Domain | CURRENT examples | FUNCTION ledger | TARGET | Key invariants | State | Migration task |
| --- | --- | --- | --- | --- | --- | --- |
| video | manage-video / video actions / video routes | FN-PER, FN-PUB, FN-ADM | `packages/domain/video/*` + Hono | ownership/event privilege、audit、static rebuild | NOT_INVENTORIED | MIG-0304 / 0603 |
| event | event/admin/manage actions/routes | FN-MNG, FN-ADM | `packages/domain/event/*` + Hono | owner>=1、visibility、audit | NOT_INVENTORIED | MIG-0305 / 0604 |
| slot | slot actions/routes | FN-ENT, FN-MNG, FN-ADM | `packages/domain/slot/*` + Hono | auth、capacity、uniqueness、notification | NOT_INVENTORIED | MIG-0305 / 0604 |
| user/X | xid/user actions/routes | FN-AUTH, FN-PER, FN-ADM | `packages/domain/user/*` + Hono | approval/public-listable/privacy | NOT_INVENTORIED | MIG-0306 / 0605 |
| permission | permission/admin/access-context | FN-X, FN-PER, FN-MNG, FN-ADM | shared permission core + Hono boundary | existing DB/access-context parity | NOT_INVENTORIED | MIG-0306 / 0605 |
| admin | admin actions/routes | FN-ADM | domain-specific Hono endpoints | admin auth、audit、danger confirmation | NOT_INVENTORIED | MIG-0306 / 0605 |
| YouTube sync | admin/manage actions + jobs | FN-ADM, FN-JOB | Hono trigger + existing jobs | quota、dedupe、background processing | NOT_INVENTORIED | MIG-0306 / 0605 |
| public reads | public routes/loaders | FN-PUB, FN-API, FN-PLAT | Astro/R2 or Hono | explicit DTO、visibility | NOT_INVENTORIED | MIG-050x / 0601 |
| auth | NextAuth/Auth.js | FN-AUTH | later compatibility target | sessions/accounts/linking | NOT_INVENTORIED | MIG-080x |
| media proxy | thumbnail/Drive/media routes | FN-API | direct/static/background where possible | URL safety、visibility、CPU/streaming | NOT_INVENTORIED | MIG-060x |

## Domain functions per SA (MIG-0304 video)

Domain stage only; Hono endpoints are MIG-0603. Full mapping with adapter-side effects: `work-items/MIG-0304.md` §Final audit.

| SA | Domain (`@flamenode/domain/video`) |
| --- | --- |
| SA-001..003 | `validateAdminVideoStatusInput`, `validateVideoPublicEligibility`, `monotonicVideoUpdatedAt`, `SAME_VIDEO_STATUS_MESSAGE`, `planVideoVisibilityFence` |
| SA-040..042 | `validateManageVideoStatusInput`, `validateVideoPublicEligibility`, `monotonicVideoUpdatedAt`, `SAME_VIDEO_STATUS_MESSAGE`, `planVideoVisibilityFence` |
| SA-012..015 | `validateChapterTime`, `resolveAdminOrEventVideoPrivilegeMode`, `decideCanEditVideoFromAccessContext` (`video.chapter_admin`) |
| SA-082..084 | `creatorOwnerCanManagePermissions`, `ownerPolicyAllows`, `adminPolicyAllows` (`video.permissions`) |
| SA-085 | `adminPolicyAllows` (`video.members`) |
| SA-086, SA-088 | `requiredFields.ts` (`firstMissingRequiredVideoField`, `unionRequiredVideoFields`, …) |
| SA-087 | `nextVideoAppLikeCount` (Auth-User keyed as CURRENT; D-03 fan-out is MIG-0605 U05) |
| SA-089 | `requiredFields.ts`, `assertAllowedVideoFieldChanges`, `buildVideoAuditSnapshot`, `VIDEO_EDIT_SECTION_PERMISSION_KEYS`, `resolveAllowedVideoEditSections` |

## MIG-0305 domain extraction — event / slot (Phase 3)

Domain stage only: the Server Actions remain the CURRENT adapter (D1 batch / CAS / audit / R2 / Queue / revalidate). Hono endpoints are MIG-0604. `@flamenode/domain/event` = `packages/domain/src/event/*`, `@flamenode/domain/slots/*` = `packages/domain/src/slots/*`.

| SA | Domain functions consumed (pure) | Kept in adapter (unchanged) |
| --- | --- | --- |
| SA-021 `renameEventId` | `event/idReuse` (via `eventIdReuse.ts`): `eventIdRenameCleanupTargets`, `isEventIdReuseDelayElapsed`, `hasCompletedEventIdRenameCleanup`, `EVENT_ID_RENAME_CLEANUP_REASON` | its own implementation (not generic event CRUD): rename fence/tombstone pre-commit + compensation, multi-table D1 batch, static queue, export cache |
| SA-022 `createEvent` | `event/idReuse` (via `eventIdReuse.ts`) | admin write guard, event/staff/questions batch, static queue |
| SA-023 `updateEvent` | `planEventVisibilityFence`, `adminEventEditPermissions` / `delegatedEventEditPermissions`, `hasAnyEventEditPermission` | revision CAS, fence SQL + R2 manifest pre-commit/compensation, cache purge |
| SA-024 `deleteEvent` | `planEventVisibilityFence` | archive guard, fence + manifest, cache purge |
| SA-025..030 event groups | none (admin-only; group fence decision is `status === "public"` inside the shared publicData fence) | admin guard, group/relation batch, group fence, static queue |
| SA-031 `upsertEventStaffMember` | `parseEventStaffPermissionKeys`, `event/ownership` (`assertEventWillRetainOwner`, `validateEventStaffUniqueness`, `assertSelfChangeConfirmation`, …) | conditional owner SQL, preset/admin-only assignment, static queue |
| SA-032 `bulkUpsertEventStaffFromCsv` | `event/ownership` | bulk owner count + version guard, static queue |
| SA-033 `removeEventStaffMember` | `event/ownership` | `remainingOperableEventOwnerSql` DELETE guard (owner-0 race test: `src/lib/event/eventOwnerZero.sqlite.execution.test.mjs`) |
| SA-034 `transferEventOwnershipAction` | `assertOwnershipTransferInput` | transfer CAS SQL |
| SA-035..037 | MIG-0303 (`@flamenode/domain/eventTemplates`); consumer only | — |
| SA-038/039 playlist | `delegatedEventEditPermissions` (via `resolveEventEditPermissions`) | settings/sync D1 + audit, sync queue, redirect |
| SA-056/057 submitted-slot danger | `slots/reservationGroups`: `resolveSlotReservationSubject` | separate dangerous transitions (not merged into generic slot CRUD), versioned CAS, notification outbox, static queue |
| SA-058..064 slot admin | none beyond existing `slots/limits` | batch planner, versioned CAS, outbox, static queue |
| SA-065 `reserveSlot` | `slots/slotIdentity` (`resolveSlotViewerRelation`, `canActAsSlotActor`), `slots/reservationIdentity` (via `reservationIdentity.ts`), `slots/reservationLimit` | reservation limit guard SQL, `commitSlotMutationPlan`, ops webhook post-commit |
| SA-066 `releaseOwnSlot` | `slots/releaseGroups` (`buildReleaseGroupDecisions`), `slots/slotIdentity` | versioned CAS release batch |
| SA-067/068 extend/merge | `slots/slotIdentity` (`resolveSlotGroupIdentity`), `slots/reservationGroups` (`resolveSlotReservationSubject`, `subjectsEqual`) | bounded group load, regroup CAS |

## Baseline row template

MIG-0003/0004で各export/HTTP methodに最低限以下を記録する。

```text
ID: SA-... | API-...
Function IDs:
Domain:
Current file/export or route+method:
Callers:
Current input/request:
Current output/response:
Auth:
Permissions:
DB reads:
DB writes:
Audit side effect:
Queue side effect:
R2/KV side effect:
Notification side effect:
External side effect:
Revalidation/redirect/client-refresh semantics:
Current tests:
Known edge cases:
State: CURRENT_VERIFIED | ...
Evidence:
```

Target migration追記:

```text
Target domain service:
Target Hono route:
Target contract:
Target tests:
Compatibility bridge:
Bridge removal condition:
Rollback:
Migration task:
```

## Migration rule

禁止:

```text
Server Action
  -> business logicをcopy
  -> Hono
```

必須:

```text
CURRENT Server Action / Route Handler
            |
            v
framework-neutral domain service
            ^
            |
      +-----+-----+
      |           |
legacy Next    Hono route
```

legacy/newが同じdomain serviceを呼ぶ期間を作り、parity testを固定する。

## Domain service constraints

`packages/domain` から禁止:

- Next imports
- Hono imports
- Astro imports
- React Router imports
- `revalidatePath`
- `redirect`
- framework `cookies()` / request APIs
- browser APIs

request context/dependenciesは明示して渡す。

```ts
updateVideo({
  actor,
  input,
  db,
  audit,
  enqueue,
  now,
})
```

## Permission rule

- UI移行を理由にpermission modelを再設計しない。
- CURRENTとHonoのpermission decisionを同一coreへ寄せる。
- access-context / DB direct経路の既存parityを維持する。
- owner=0を作らない。
- admin-only処理をclient判定だけで開かない。

## Side-effect parity

mutation parityはDB結果だけでは不十分。

最低限確認:

- D1 state
- audit event
- Queue enqueue/reason
- R2/static rebuild/visibility state
- KV mirror/cache where applicable
- notifications
- external APIs
- redirect/revalidationに依存したclient refresh semantics

`revalidatePath()`はHonoへ移植せず、意味を以下へ分解する。

- SPA query invalidation/refetch
- public projection dirty
- public site build dirty
- no-op if no longer required

## Error contract

Target APIはdomain errorを明示する。

```text
UNAUTHENTICATED
FORBIDDEN
NOT_FOUND
CONFLICT
VALIDATION_ERROR
RATE_LIMITED
UNAVAILABLE
INTERNAL
```

HTTP status / user-safe message / internal diagnosticsを分離する。
CURRENT clientが依存するerror behaviorは先にbaseline化する。

## CPU rule

HTTP pathで避ける:

- large projection
- HTML generation
- large JSON transformation
- image processing
- unrelated notification work
- long external sync

基本:

```text
auth
-> validate
-> bounded D1 read/write
-> enqueue if needed
-> return
```

実Cloudflare metricsをAcceptance Gateに使う。
