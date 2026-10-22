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

## MIG-0306 domain mapping (exact SA IDs)

Domain stage only (no Hono route, no traffic change). Every SA below also passes the shared write guard, whose identity and cost guard decision are `@flamenode/domain/admin#evaluateWriteIdentity` / `#evaluateCostGuardCore` (U01). "Adapter" lists what intentionally stays in the CURRENT action: D1 reads, drizzle SQL, `mutateWithAudit` (strict audit + expected-row CAS), Queue/KV/R2 and revalidation. The actor stays the Auth User (`guard.user.id`) in every row.

| SA | Action | Domain functions | Adapter only (reason) | Unit |
| --- | --- | --- | --- | --- |
| SA-016 | `setCostGuardMode` | `admin#parseCostGuardModeInput` | system_settings CAS + audit, KV mirror | U03 |
| SA-017 | `setMaintenanceMode` | `admin#parseMaintenanceModeInput`, `#resolveMaintenanceTargetMode`, `#resolveOperationMode` | same as SA-016 | U03 |
| SA-018 | `setCostGuardOverride` | `admin#parseCostGuardOverrideInput`, `#OVERRIDE_DURATION_SEC` | settings patch + CAS + audit | U03 |
| SA-019 | `setDisabledFeatures` | `admin#parseDisabledFeaturesInput`, `#checkExpectedDisabledFeatures` | settings patch + CAS + audit | U03 |
| SA-020 | `clearCostGuardOverride` | `admin#parseClearCostGuardOverrideInput` | settings patch + CAS + audit | U03 |
| SA-043 | `createModerationCase` | `admin#normalizeModerationCaseType`, `#normalizeModerationText`, `#parseModerationDueAt`, `#normalizeModerationXUserId`, `#normalizeModerationVideoStatus` | open-case INSERT, video visibility transition (MIG-0304 U02) | U03 |
| SA-044 | `updateModerationCaseStatus` | `admin#normalizeModerationResolutionStatus`, `#normalizeModerationText`, `#normalizeModerationVideoStatus` | case CAS, visibility transition (MIG-0304 U02) | U03 |
| SA-045 | `retryFailedNotification` | `admin#isTerminalNotificationFailure`, `#notificationRetryPatch` | outbox CAS + audit + wake | U03 |
| SA-046 | `cancelNotification` | `admin#decideNotificationCancel`, `#notificationCancelPatch` | outbox CAS + audit | U03 |
| SA-047 | `forceResendNotification` | — | ADAPTER_ONLY: builds a new outbox row through `notifications/enqueue` (FN-JOB) | U03 |
| SA-048 | `retryAllFailedNotifications` | `admin#TERMINAL_NOTIFICATION_FAILURE_STATUSES`, `#notificationRetryPatch` | bounded read + CAS + audit + wake | U03 |
| SA-049 | `updateGlobalEditableFields` | — | ADAPTER_ONLY here: its rules are `generalEditPermissionsCore.ts`, owned by MIG-0304 U01 | U03 |
| SA-050 | `repairDanglingPublicVisibilityManifestEntry` | — | ADAPTER_ONLY by task rule: publication-safety repair stays individual | U03 |
| SA-051 | `createTermsVersion` | `admin#parseTermsDraftInput` | INSERT + audit | U03 |
| SA-052 | `updateTermsVersion` | `admin#parseTermsDraftInput` | draft-only CAS + audit | U03 |
| SA-053 | `publishTermsVersion` | `admin#decideTermsPublish`, `#nextTermsPublishedAt` | archive-previous + publish CAS + rules rebuild queue | U03 |
| SA-054 | `broadcastTermsReaccept` | `admin#parseTermsReacceptBroadcastInput` | re-accept predicate (`terms/reaccept.ts`, SQL), batch audit | U03 |
| SA-055 | `archiveTermsVersion` | — | ADAPTER_ONLY: one CAS + optional rules rebuild, no rule beyond the row state | U03 |
| SA-069 | `enqueueStaticBackfillBatch` | `admin#STATIC_BACKFILL_KINDS`, `#parseStaticBackfillState`, `#withStaticBackfillRun` | KV state, scan + queue enqueue | U04 |
| SA-070 | `retryFailedStaticRebuild` | — | ADAPTER_ONLY: queue row retry DML | U04 |
| SA-071 | `enqueueStaticRebuildAdmin` | — | ADAPTER_ONLY: queue enqueue | U04 |
| SA-072 | `enqueueSharedRelatedInputsRebuildAdmin` | — | ADAPTER_ONLY: queue enqueue | U04 |
| SA-073 | `retryAllFailedStaticRebuild` | — | ADAPTER_ONLY: bounded queue retry DML | U04 |
| SA-074 | `commitAcceptLatestTerms` | `user#isLatestTermsAlreadyAccepted` | consent INSERT + user CAS + audit | U04 |
| SA-075 | `acceptLatestTerms` | via SA-074 | redirect | U04 |
| SA-076 | `acceptOnboardingTerms` | via SA-074 | — | U04 |
| SA-077 | `setUserRole` | `user#parseSetUserRoleInput` | user CAS + audit | U04 |
| SA-078 | `setUserBanned` | `user#parseSetUserBannedInput` | user CAS + audit | U04 |
| SA-079 | `setUserNotifications` | `user#parseSetUserNotificationsInput`, `#userNotificationsAuditReason` | pending outbox cancel in the same batch | U04 |
| SA-080 | `setUserCanCreateEvents` | `user#parseSetUserCanCreateEventsInput` | user CAS + audit | U04 |
| SA-081 | `refreshXUserIcon` | `xid#normalizeXId` | ADAPTER_ONLY otherwise: external icon fetch + R2 | U04 |
| SA-090 | `approveXIdLinkRequest` | `xid#buildXIdentityDecisionFields`, `#processedXIdRequestMessage`, `#isRetryableXIdMutationError`, `#validateXIdentityRequestShape` | link/alias/slot-bind batch + audit + post-commit | U04 |
| SA-091 | `rejectXIdLinkRequest` | `xid#processedXIdRequestMessage`, `#isRetryableXIdMutationError` | request CAS + audit | U04 |
| SA-092 | `createXIdMergeRequest` | `xid#normalizeXId`, `#validateXIdentityRequestShape` | merge body untouched (task rule) | U02 |
| SA-093 | `approveXIdMergeRequest` | — | merge body untouched (task rule) | U02 |
| SA-094 | `rejectXIdMergeRequest` | — | merge body untouched (task rule) | U02 |
| SA-095 | `rejectXIdMergeRevert` | `xid#buildXIdentityDecisionFields` | merge body untouched (task rule) | U02 |
| SA-096 | `executeXIdMergeRequest` | `xid#validateXIdentityRequestShape`; merge plan `xid#buildXIdMergeBeforeState`, `#buildXIdMergeAfterState` | `merge.ts` body, `xIdMergeStateMatchesSql` CAS, `mergeBudget`, `mergeAudits` | U02 |
| SA-097 | `approveXIdMergeRevert` | `xid#isRevertDeadlineOpen`, `#validateXIdentityRequestShape`; same merge plan as SA-096 | revert body untouched (task rule) | U02 |
| SA-098 | `setActiveXId` | `xid#normalizeXId` | approved-link read + user CAS | U04 |
| SA-099 | `requestXIdLink` | `xid#parseXIdentityInput`, `#validateXIdentityRequestShape`, `#isXIdLinkRequestType`, `#reconcilePendingXIdRequest`, `#isRetryableXIdMutationError` | pending insert (`xidPendingInsert.ts`) + audit | U04 |
| SA-100 | `cancelXIdLinkRequest` | `xid#buildXIdentityDecisionFields`, `#processedXIdRequestMessage`, `#isRetryableXIdMutationError` | request CAS + audit | U04 |
| SA-101 | `requestXIdMergeRevert` | `xid#isRevertDeadlineOpen` | request insert + audit | U04 |
| SA-102 | `updateXIdProfile` | `xid#normalizeXId` | profile CAS + static rebuild | U04 |
| SA-103 | `deleteLinkedXId` | `xid#normalizeXId` | `xLinkDependencies.ts` (SQL) + link delete | U04 |
| SA-104 | `setXIdIcon` | `xid#normalizeXId` | icon resolution + R2 | U04 |
| SA-105 | `uploadXIdIcon` | `xid#normalizeXId` | image upload + R2 | U04 |
| SA-106 | `queueYoutubeMetadataResync` | — | ADAPTER_ONLY: sync-state CAS + wake | U04 |

## MIG-0611 Hono Personal read APIs (Phase 6)

New authenticated read-only endpoints (no CURRENT `/api/*` equivalent; CURRENT pages are Server Components reading D1). No Worker Route / traffic change. Parity: `apps/api/test/personal.parity.test.mjs` runs the Hono routes and the real CURRENT loaders on the same seed. All responses `Cache-Control: private, no-store`; `sessionMiddleware` + `requireAuth` (401 anonymous, 403 banned); 503 `{error:"unavailable"}` where CURRENT throws to the error page. CPU: not measured (MIG-0606).

| Endpoint | CURRENT source | Target (Hono) | D1 statements incl. session lookup | Notes | CPU | State |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/personal/session` | `src/lib/auth/guard.tsx` requireSession / `currentUser.ts` | `apps/api/src/routes/personal/session.ts` | 2 | user DTO incl. `is_tos_accepted`, `accepted_terms_version_id`, derived `terms_reaccept_required`, resolved `active_x_user_id`; no email | unmeasured | BRIDGED |
| `GET /api/personal/dashboard` | `app/(auth)/dashboard/page.tsx` | `apps/api/src/routes/personal/dashboard.ts` | 3 | sections are bounded JSON subqueries; section failure -> same empty data (200) as CURRENT's try/catch; stats aggregate has no LIMIT (1 row, as CURRENT) | unmeasured | BRIDGED |
| `GET /api/personal/library?tab&page` | `app/(auth)/dashboard/library/page.tsx` | `apps/api/src/routes/personal/library.ts` | 3 | 24/page, page 1..500, LIMIT 25 OFFSET | unmeasured | BRIDGED |
| `GET /api/personal/settings?tab&x&onboarding` | `app/(auth)/dashboard/settings/page.tsx` | `apps/api/src/routes/personal/settings.ts` | 3 | profile text read as rows; request history 50; candidates for the shown panel only; response can exceed 64 KiB with long profiles (CURRENT parity) | unmeasured | BRIDGED |
| `GET /api/personal/onboarding` | `app/(auth)/onboarding/page.tsx` | `apps/api/src/routes/personal/onboarding.ts` | 2 (+1 rules fallback) | no write: `maybeMarkOnboardingComplete` moves to MIG-0702 POST; rules via R2 `rules/current.json` (<= 64 KiB) then D1 published terms (<= 64 KiB), enforce-mode visibility guard | unmeasured | BRIDGED |

Divergences recorded: linked X rows capped at 100 (`MAX_LINKED_X_USERS`, ordered by id; CURRENT unbounded); no Cache API / rebuild enqueue for rules.

## MIG-0625 Hono Admin read APIs A (Phase 6)

New admin-only read endpoints (no CURRENT `/api/*` equivalent). No Worker Route / traffic change. GET only, mounted at `/api/admin-read` (never shares a prefix with the mutating `/api/admin` write guard). Guard: `sessionMiddleware` + `requireAuth` (401 anonymous, 403 banned) + `role === "admin"` (403 `{error:"Forbidden",redirect:"/dashboard"}`, CURRENT `(admin)/layout.tsx`; moderators rejected). All responses `Cache-Control: private, no-store`. Parity: `apps/api/test/adminRead.parity.test.mjs` (queries copied from the page loaders + the real lib functions, node:sqlite with all migrations). CPU: not measured (MIG-0606).

| Endpoint | CURRENT source | Target (Hono) | D1 statements incl. session lookup | Notes | CPU | State |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/admin-read/users?view&q&status&page` | `app/(admin)/admin/users/page.tsx` | `apps/api/src/routes/adminRead/users.ts` | 2 | 50/page; discord, xid, permissions views; `view=links` -> `{redirect}`; D1 failure -> 200 `degraded`; xid `icon_url` null (R2 icon map not reproduced) | unmeasured | BRIDGED |
| `GET /api/admin-read/users/:id` | `app/(admin)/admin/users/[id]/page.tsx` | `apps/api/src/routes/adminRead/users.ts` | 3 | lists capped (X 100, videos 20, audit 15+15, requests 10); audit before/after payloads not returned; unknown id 404 | unmeasured | BRIDGED |
| `GET /api/admin-read/videos?q&status&event&page` | `app/(admin)/admin/videos/page.tsx` | `apps/api/src/routes/adminRead/videos.ts` | 3 | 50/page; event options LIMIT 100 (CURRENT 200); `reviewSummaries: "deferred"`; D1 failure -> 200 `degraded` | unmeasured | BRIDGED |
| `GET /api/admin-read/events?sort&filter&q` | `app/(admin)/admin/events/page.tsx` | `apps/api/src/routes/adminRead/events.ts` | 2 | LIMIT 60; rendered columns only; returns server `now` for the badges | unmeasured | BRIDGED |
| `GET /api/admin-read/moderation?type&status&overdue` | `app/(admin)/admin/moderation/page.tsx` | `apps/api/src/routes/adminRead/moderation.ts` | 2 | LIMIT 100; D1 failure -> 503 | unmeasured | BRIDGED |
| `GET /api/admin-read/x-link-requests` | `app/(admin)/admin/x-link-requests/page.tsx` | `apps/api/src/routes/adminRead/xLinkRequests.ts` | 3 | pending 100 / rejected 10 / audit 30 (only `changedKeys` returned); icons signed with `env.AUTH_SECRET` (signer copied verbatim from PR #345 `routes/manage/icon.ts`), no secret -> internal icons null; D1 failure -> 503 | unmeasured | BRIDGED |
| `GET /api/admin-read/x-id-merges?view&impact` | `app/(admin)/admin/x-id-merges/page.tsx` | `apps/api/src/routes/adminRead/xIdMerges.ts` | 2 (3 with `impact`) | merge requests 50, reverts 100; impact counts + preview (51) of the selected pending/approved request in ONE union statement; restore JSON never returned (`has_restore_snapshot`); D1 failure -> 503 | unmeasured | BRIDGED |
| `GET /api/admin-read/events/templates` | `app/(admin)/admin/events/templates/page.tsx` | `apps/api/src/routes/adminRead/eventTemplates.ts` | 3 | CURRENT lists behind requireAdminWrite("admin_event_templates"): TOS / re-accept / CostGuard denial -> empty list (`guardOk:false`); list capped at 100 (CURRENT unbounded) | unmeasured | BRIDGED |
| `GET /api/admin-read/events/new?template` | `app/(admin)/admin/events/new/page.tsx` | `apps/api/src/routes/adminRead/eventTemplates.ts` | 3 | same guard/list; selected template returned as name + raw `settings_json` (<= 64 KiB); `snapshotToFormInitial` not ported (`formInitial:"deferred"`) | unmeasured | PARTIAL |

Not covered (see work item blockers): videos/[id], videos/[id]/members, events/[id]/*, event-groups/*, events/new form initial, users/[id]/edit, review summaries, xid icon projection.

## MIG-0601 Hono Route Handlers — bounded low-risk reads (Phase 6)

Code landing only: no Worker Route / traffic change; the CURRENT Next handlers stay. Parity: `apps/api/test/mig0601.parity.test.mjs` runs the Hono route and the CURRENT implementation on the same input. CPU is local Node `process.cpuUsage` per `app.request()` with D1/R2 doubles (remote I/O excluded), warm, n=1000 (`project-files/migration-review/pr329-cpu-local.log`); Workers p95 and 1102 stay with MIG-0606.

| RH | Method & CURRENT path | Target (Hono) | Permission | Invariants & Effects | CPU p50 / p95 (local Node) | State |
| --- | --- | --- | --- | --- | --- | --- |
| RH-017 | `GET /api/health/deep` | `apps/api/src/routes/health.ts` | Bearer token (`WORKER_ADMIN_TOKEN`) | token gate identical to CURRENT (503 unset / 401 missing, malformed or wrong; constant-time compare; no-store). Authorized requests fail closed with CURRENT's failure response `503 {ok:false, service}` and read no binding, because the check body (`src/lib/health/deepHealth.ts`: schema version + tables, artifact SLO, queue config, visibility manifest/fence join) is not ported. Do not route `/api/health/deep` to Hono until it is | 0.050ms / 0.130ms | BRIDGED (gate only) |
| RH-018 | `GET /api/health` | `apps/api/src/routes/health.ts` | public | only a 40-hex `BUILD_COMMIT_SHA` (lower-cased); 503 without one; no other binding read; no-store | 0.055ms / 0.131ms | BRIDGED |
| RH-026 | `GET /api/public/about-stats` | `apps/api/src/routes/publicAboutStats.ts` | public | 1 R2 GET `top/sections/stats.v1.json` (<= 64 KiB, body cancelled when oversized), `normalizeTopStatsSection` semantics, 3 public counters only, fixed Cache API key, 503 `{stats:null}` no-store on any failure; no D1 | 0.038ms / 0.095ms | BRIDGED |
| RH-029 | `GET /api/software/suggestions` | `apps/api/src/routes/softwareSuggestions.ts` | public | isolate rate limit 60/min (key cap 2048), `q` <= 64 chars, limit 1..50 (0 / non-numeric -> 20), D1 <= 2 bounded reads, active-only DTO allowlist, SHA-256 ETag / 304, 503 `database_unavailable` | 0.228ms / 0.615ms | BRIDGED |
