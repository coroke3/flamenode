# FlameNode Existing Function Inventory

> Status: Active / Functional parity source of truth
> Last updated: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Architecture: [`README.md`](README.md)
> Progress: [`STATUS.md`](STATUS.md)
>
> 目的: リデザイン + framework移行で「画面はあるが機能が消えた」を防ぐ。
> route一覧ではなく **ユーザー能力・権限・副作用・背景処理単位** で既存機能を追跡する。

## 1. Completion rule

移行完了時に以下を満たすこと。

```text
UNKNOWN required functions = 0
DETAIL_AUDIT_REQUIRED = 0
UNVERIFIED migrated functions = 0
Screens without function mapping = 0
Server actions/routes without disposition = 0
Background jobs without disposition = 0
Permission rules without parity evidence = 0
Side effects without parity evidence = 0
```

機能削除は移行に紛れ込ませない。

削除時:

```text
BASELINE_KNOWN
→ REMOVAL_PROPOSED
→ explicit approval
→ REMOVED_APPROVED
```

## 2. Function state

- `BASELINE_KNOWN`: 現行コード/画面から存在を確認した
- `DETAIL_AUDIT_REQUIRED`: 存在は確認したがinput/permission/effect/test棚卸し未完
- `CURRENT_VERIFIED`: CURRENT contractをコード/testで棚卸し完了
- `MIGRATION_IN_PROGRESS`: 新経路を実装中
- `PARITY_VERIFIED`: TARGETで既存契約維持を確認
- `BRIDGED`: legacy/new共存中
- `REMOVAL_PROPOSED`: 削除候補、承認前
- `REMOVED_APPROVED`: 明示承認済み削除
- `BLOCKED`: parity確認不能

画面単位stateは `ROUTE_MATRIX.md`、server単位stateは `API_MATRIX.md`。

---

# 3. Inventory evidence baseline

## Screen/UI surfaces

既存redesign inventoryで **86 screens** を確認済み。

- Public: 16
- Personal: 6
- Entry: 3
- Manage: 12
- Admin: 45
- System: 4

正本:

- `docs/design-redesign/ROUTE_INVENTORY.md`
- `docs/design-redesign/PAGE_COVERAGE.md`
- `app/(redesign)/dev/redesign/_catalog.ts`

MIG-0007で86画面すべてをfunction IDへ紐付ける。

## Server Action surface seeds

2026-10-06時点で少なくとも以下の`"use server"` surfaceを確認済み。MIG-0002でexport/function単位へ分解する。

```text
src/lib/actions/api-endpoints.ts
src/lib/actions/manage-video.ts
src/lib/actions/youtube-sync-admin.ts
src/lib/actions/audit-admin.ts
src/lib/actions/admin.ts
src/lib/actions/terms.ts
src/lib/actions/permissions-admin.ts
src/lib/actions/rules.ts
src/lib/actions/xid.ts
src/lib/actions/slot.ts
src/lib/actions/announcement.ts
src/lib/actions/cost-guard.ts
src/lib/actions/chapter.ts
src/lib/actions/user-admin.ts
src/lib/actions/public-visibility-repair.ts
src/lib/actions/video/interaction.ts
src/lib/actions/event-template-admin.ts
src/lib/actions/slot-admin.ts
src/lib/actions/xid-merge-admin.ts
src/lib/actions/xid-admin.ts
src/lib/actions/notification-admin.ts
src/lib/actions/video/adminMembers.ts
src/lib/actions/event-admin.ts
src/lib/actions/moderation-admin.ts
src/lib/actions/slot-admin-danger.ts
src/lib/actions/event-group-admin.ts
src/lib/actions/event-staff-admin.ts
src/lib/actions/event-admin-danger.ts
src/lib/actions/event-youtube-playlist.ts
src/lib/actions/video/updateVideo.ts
src/lib/actions/video/createFreeVideo.ts
src/lib/actions/static-rebuild-admin.ts
src/lib/actions/video-collab-perms.ts
src/lib/actions/video/submitSlotVideo.ts
```

加えてpage内inline Server Actionが存在するため、`src/lib/actions/`だけで棚卸し完了扱いにしない。

## API route top-level seeds

現行 `app/api/` 直下:

```text
account
auth
admin
event-endpoints
events
google-drive-image
health
internal
live
media
public
software
videos
youtube-thumbnail
```

MIG-0002で全`route.ts`をendpoint/method単位へ展開する。

## Background surface

CURRENT production Worker:

```text
flamenode-web
flamenode-fast-jobs
flamenode-content-jobs
flamenode-sync-jobs
```

background内部のCron/Queue/job typeはMIG-0003/0005で棚卸しする。

---

# 4. Public / discovery / playback

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-PUB-001 | トップで新着・注目・イベント等を発見 | `/` | publicのみ、棚/順序契約 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-002 | 作品詳細を開く | `/[id]` | internal/YouTube alias、visibility | DETAIL_AUDIT_REQUIRED |
| FN-PUB-003 | YouTube作品を再生 | `/[id]` | embed/player状態 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-004 | 作品metadata/説明/credit/music表示 | `/[id]` | public DTO、SEO | DETAIL_AUDIT_REQUIRED |
| FN-PUB-005 | 作品chapter表示 | `/[id]`, chapter action | public/private境界 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-006 | view計測 | `/[id]`, video interaction | 重複/集計/非同期副作用 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-007 | like等の作品interaction | `/[id]`, video interaction | auth/匿名状態、idempotency | DETAIL_AUDIT_REQUIRED |
| FN-PUB-008 | viewer utility/private overlay | `/[id]` | private data leak禁止 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-009 | イベント一覧 | `/event` | public eventのみ | DETAIL_AUDIT_REQUIRED |
| FN-PUB-010 | イベント詳細/作品一覧 | `/event/[id]` | visibility/stage | DETAIL_AUDIT_REQUIRED |
| FN-PUB-011 | イベントrelease連続閲覧 | `/event/[id]/release` | release順/公開状態 | DETAIL_AUDIT_REQUIRED |
| FN-PUB-012 | 公開枠状況 | `/event/[id]/slots` | live/公開可能情報のみ | DETAIL_AUDIT_REQUIRED |
| FN-PUB-013 | イベントグループ一覧/詳細 | `/groups*` | group visibility | DETAIL_AUDIT_REQUIRED |
| FN-PUB-014 | 作品一覧・filter・search | `/list` | filter/query semantics | DETAIL_AUDIT_REQUIRED |
| FN-PUB-015 | recommend表示 | `/recommend` | algorithm/output contract | DETAIL_AUDIT_REQUIRED |
| FN-PUB-016 | trending表示 | `/trending` | analytics artifact/order | DETAIL_AUDIT_REQUIRED |
| FN-PUB-017 | creator一覧 | `/user` | public-listable X/userのみ | DETAIL_AUDIT_REQUIRED |
| FN-PUB-018 | creator profile/作品 | `/user/[id]` | visibility/profile contract | DETAIL_AUDIT_REQUIRED |
| FN-PUB-019 | creator portfolio | `/user/[id]/portfolio` | work ordering/navigation | DETAIL_AUDIT_REQUIRED |
| FN-PUB-020 | about | `/about` | static content | DETAIL_AUDIT_REQUIRED |
| FN-PUB-021 | rules public閲覧 | `/rules` | active terms/version | DETAIL_AUDIT_REQUIRED |
| FN-PUB-022 | SEO/canonical/OGP | public detail pages | URL/metadata parity | DETAIL_AUDIT_REQUIRED |

---

# 5. Authentication / onboarding / account

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-AUTH-001 | Discord OAuth login | Auth.js/API | callback/origin/session | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-002 | session復元 | auth/current user | existing sessions compatibility | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-003 | Discord account linking | auth adapter/config | duplicate/link safety | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-004 | banned/role state反映 | auth/session | authz safety | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-005 | onboarding | `/onboarding` | required initial steps | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-006 | terms同意 | onboarding/terms action | version/user acceptance | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-007 | auth complete redirect | `/auth/complete` | safe redirect/canonical host | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-008 | logout/session終了 | Auth.js | cookie/session invalidation | DETAIL_AUDIT_REQUIRED |
| FN-AUTH-009 | account API | `app/api/account` | authenticated private data | DETAIL_AUDIT_REQUIRED |

---

# 6. Personal dashboard / video ownership

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-PER-001 | dashboardで必要作業/作品状態を見る | `/dashboard` | own/related data only | DETAIL_AUDIT_REQUIRED |
| FN-PER-002 | 作品編集 | `/dashboard/edit/[id]`, manage-video/updateVideo | ownership/collab/event privilege | DETAIL_AUDIT_REQUIRED |
| FN-PER-003 | 共同編集権限管理 | permissions page, video-collab-perms | owner/permission parity | DETAIL_AUDIT_REQUIRED |
| FN-PER-004 | library閲覧 | `/dashboard/library` | authenticated data | DETAIL_AUDIT_REQUIRED |
| FN-PER-005 | user settings | `/dashboard/settings` | profile/X/session interactions | DETAIL_AUDIT_REQUIRED |
| FN-PER-006 | personal YouTube playlist確認 | `/dashboard/youtube-playlists` | quota/external state | DETAIL_AUDIT_REQUIRED |
| FN-PER-007 | X ID登録/変更/申請 | settings/xid actions | approval/link constraints | DETAIL_AUDIT_REQUIRED |

---

# 7. Entry / submission / slot

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-ENT-001 | entry入口で参加/投稿方法を判断 | `/entry` | auth/event/slot state | DETAIL_AUDIT_REQUIRED |
| FN-ENT-002 | slot確保/状態管理 | slot actions | capacity/duplicate/auth | DETAIL_AUDIT_REQUIRED |
| FN-ENT-003 | slot付き作品提出 | `/entry/slotted`, submitSlotVideo | deadline/slot ownership | DETAIL_AUDIT_REQUIRED |
| FN-ENT-004 | 通常作品投稿 | `/entry/unslotted`, createFreeVideo | duplicate/input/visibility defaults | DETAIL_AUDIT_REQUIRED |
| FN-ENT-005 | YouTube quick input/metadata取得 | entry/video | duplicate detection/quota | DETAIL_AUDIT_REQUIRED |
| FN-ENT-006 | custom question回答 | entry/event | event schema/validation | DETAIL_AUDIT_REQUIRED |

---

# 8. Event management

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-MNG-001 | 担当イベント一覧/要対応把握 | `/manage` | staff scope | DETAIL_AUDIT_REQUIRED |
| FN-MNG-002 | event workspace overview | `/manage/events/[id]` | event permission | DETAIL_AUDIT_REQUIRED |
| FN-MNG-003 | audience情報確認 | `.../audience` | permission/privacy | DETAIL_AUDIT_REQUIRED |
| FN-MNG-004 | event settings編集 | `.../edit`, event actions | permission/stage/validation | DETAIL_AUDIT_REQUIRED |
| FN-MNG-005 | review queue/審査 | `.../review` | reviewer permission/status transition | DETAIL_AUDIT_REQUIRED |
| FN-MNG-006 | slot運用 | `.../slots`, slot admin | slot state/notification | DETAIL_AUDIT_REQUIRED |
| FN-MNG-007 | staff管理 | `.../staff`, event-staff | owner最低1人/permission preset | DETAIL_AUDIT_REQUIRED |
| FN-MNG-008 | event作品一覧管理 | `.../videos` | event privilege/filters | DETAIL_AUDIT_REQUIRED |
| FN-MNG-009 | event作品1件処理 | `.../videos/[videoId]` | status/edit permission/audit | DETAIL_AUDIT_REQUIRED |
| FN-MNG-010 | event YouTube playlist同期管理 | `.../youtube-playlist` | quota/sync state | DETAIL_AUDIT_REQUIRED |
| FN-MNG-011 | 通知失敗/状態管理 | `/manage/notifications` | event scope/retry | DETAIL_AUDIT_REQUIRED |
| FN-MNG-012 | X link request処理 | `/manage/x-link-requests` | delegated permission/audit | DETAIL_AUDIT_REQUIRED |

---

# 9. Admin capabilities

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-ADM-001 | admin dashboard/対応待ち | `/admin` | admin only | DETAIL_AUDIT_REQUIRED |
| FN-ADM-002 | announcements CRUD | `/admin/announcements*`, announcement action | publish state/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-003 | API endpoint設定/管理 | `/admin/api-endpoints`, api-endpoints action | admin/security | DETAIL_AUDIT_REQUIRED |
| FN-ADM-004 | audit検索/詳細 | `/admin/audit*` | immutable/auditable access | DETAIL_AUDIT_REQUIRED |
| FN-ADM-005 | audit restore | `/admin/audit/restore` | dangerous action/strict audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-006 | audit settings | `/admin/audit/settings` | admin write/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-007 | cost guard | `/admin/cost-guard` | operation mode/full-row CAS/KV mirror | DETAIL_AUDIT_REQUIRED |
| FN-ADM-008 | event groups CRUD | `/admin/event-groups*` | slug/relation/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-009 | events CRUD/admin detail | `/admin/events*` | owner invariant/stage/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-010 | event template管理 | `/admin/events/templates` | template integrity | DETAIL_AUDIT_REQUIRED |
| FN-ADM-011 | event staff admin | admin/manage staff | owner/permission invariant | DETAIL_AUDIT_REQUIRED |
| FN-ADM-012 | dangerous event operations | event-admin-danger | explicit admin/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-013 | health dashboard | `/admin/health` | diagnostic/read-only semantics | DETAIL_AUDIT_REQUIRED |
| FN-ADM-014 | integrity checks | `/admin/health/integrity` | data health/no mutation by default | DETAIL_AUDIT_REQUIRED |
| FN-ADM-015 | history閲覧 | `/admin/history` | audit/history distinction | DETAIL_AUDIT_REQUIRED |
| FN-ADM-016 | legacy import | `/admin/import` | dedicated legacy boundary/preview | DETAIL_AUDIT_REQUIRED |
| FN-ADM-017 | moderation cases | `/admin/moderation` | state transition/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-018 | notification admin/retry | `/admin/notifications` | retry/idempotency/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-019 | permission simulator | `/admin/permissions/simulator` | must match real permission core | DETAIL_AUDIT_REQUIRED |
| FN-ADM-020 | rules/terms CRUD | `/admin/rules*` | versioning/acceptance effect | DETAIL_AUDIT_REQUIRED |
| FN-ADM-021 | security diagnostics | `/admin/security` | admin-only/no secret leak | DETAIL_AUDIT_REQUIRED |
| FN-ADM-022 | spreadsheet/DB browser | `/admin/spreadsheet` | admin/read-write boundary | DETAIL_AUDIT_REQUIRED |
| FN-ADM-023 | static build/rebuild管理 | `/admin/static-builds`, static-rebuild-admin | queue/job state/idempotency | DETAIL_AUDIT_REQUIRED |
| FN-ADM-024 | users search/detail/edit | `/admin/users*`, user-admin | auth state/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-025 | videos search/detail/admin | `/admin/videos*`, admin/manage actions | status/permission/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-026 | video members admin | `/admin/videos/[id]/members`, adminMembers | membership/permission | DETAIL_AUDIT_REQUIRED |
| FN-ADM-027 | workers monitoring | `/admin/workers` | worker/job health | DETAIL_AUDIT_REQUIRED |
| FN-ADM-028 | X ID merge | `/admin/x-id-merges`, xid-merge-admin | destructive merge/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-029 | X link requests | `/admin/x-link-requests`, xid-admin | approval/audit | DETAIL_AUDIT_REQUIRED |
| FN-ADM-030 | YouTube quota | `/admin/youtube-quota` | quota counters/thresholds | DETAIL_AUDIT_REQUIRED |
| FN-ADM-031 | YouTube sync管理 | `/admin/youtube-sync*`, youtube-sync-admin | retry/quota/idempotency | DETAIL_AUDIT_REQUIRED |

---

# 10. Public data / static delivery / visibility

| ID | Existing function | Main surfaces | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-PLAT-001 | D1をcanonical sourceにする | DB/domain | R2/KVをcanonicalにしない | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-002 | public DTO projection | public API/static generator | explicit safe DTO only | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-003 | static artifact generation | content-jobs/static rebuild | coalesce/retry/dedupe | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-004 | visibility fence | public loader/manifest | public→private即fail-closed | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-005 | visibility repair | public-visibility-repair | safe repair/audit | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-006 | R2 artifact hash/dedupe | content/static artifact | unnecessary PUT回避/integrity | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-007 | degraded D1/public fallback policy | static delivery | fail-open禁止対象を維持 | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-008 | search index/shards | content-jobs/public search | bounded generation/query contract | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-009 | score/trending analytics | jobs/R2 analytics | scoring/order contract | DETAIL_AUDIT_REQUIRED |
| FN-PLAT-010 | content build/rebuild admin visibility | admin static builds | state/retry visibility | DETAIL_AUDIT_REQUIRED |

---

# 11. Media / external / live APIs

| ID | Existing function | Current API area | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-API-001 | event endpoint API | `app/api/event-endpoints` | configured/public endpoint contract | DETAIL_AUDIT_REQUIRED |
| FN-API-002 | events API | `app/api/events` | auth/public DTO boundaries | DETAIL_AUDIT_REQUIRED |
| FN-API-003 | videos API | `app/api/videos` | interaction/private overlay/public DTO | DETAIL_AUDIT_REQUIRED |
| FN-API-004 | public API | `app/api/public` | explicit DTO/no leak | DETAIL_AUDIT_REQUIRED |
| FN-API-005 | internal API | `app/api/internal` | internal authentication/bounded use | DETAIL_AUDIT_REQUIRED |
| FN-API-006 | live API | `app/api/live` | realtime/current state | DETAIL_AUDIT_REQUIRED |
| FN-API-007 | software catalog API | `app/api/software` | normalized catalog/search | DETAIL_AUDIT_REQUIRED |
| FN-API-008 | health API | `app/api/health` | diagnostic semantics | DETAIL_AUDIT_REQUIRED |
| FN-API-009 | YouTube thumbnail proxy | `app/api/youtube-thumbnail` | URL safety/cache/CPU | DETAIL_AUDIT_REQUIRED |
| FN-API-010 | Google Drive image proxy | `app/api/google-drive-image` | URL safety/cache/CPU | DETAIL_AUDIT_REQUIRED |
| FN-API-011 | media APIs | `app/api/media` | R2/media visibility/streaming | DETAIL_AUDIT_REQUIRED |

---

# 12. Background jobs / integrations

| ID | Existing function | Current owner | Critical contract | State |
| --- | --- | --- | --- | --- |
| FN-JOB-001 | fast job scheduling/processing | `flamenode-fast-jobs` | bounded work/retry | DETAIL_AUDIT_REQUIRED |
| FN-JOB-002 | content/static generation | `flamenode-content-jobs` | 1-target/coalesce/retry | DETAIL_AUDIT_REQUIRED |
| FN-JOB-003 | sync jobs | `flamenode-sync-jobs` | external sync/quota/retry | DETAIL_AUDIT_REQUIRED |
| FN-JOB-004 | Queue wake/DLQ/recovery | workers/queues | idempotency/redelivery/recovery | DETAIL_AUDIT_REQUIRED |
| FN-JOB-005 | YouTube metadata/playlist sync | sync/actions | quota/dedupe/failure state | DETAIL_AUDIT_REQUIRED |
| FN-JOB-006 | notifications/Discord | notification subsystem | delivery/retry/no duplicate | DETAIL_AUDIT_REQUIRED |
| FN-JOB-007 | cleanup jobs | workers | bounded deletion/no data loss | DETAIL_AUDIT_REQUIRED |
| FN-JOB-008 | static rebuild follow-up fanout | content-jobs | dependency/dedupe/no storm | DETAIL_AUDIT_REQUIRED |

---

# 13. Cross-cutting invariants

これらは独立画面ではないが、全移行で欠落禁止。

| ID | Invariant | Evidence area | State |
| --- | --- | --- | --- |
| FN-X-001 | event ownerを0人にしない | permission/event staff | DETAIL_AUDIT_REQUIRED |
| FN-X-002 | UIだけで認可しない | auth/write guards | DETAIL_AUDIT_REQUIRED |
| FN-X-003 | public APIは明示DTOのみ | publicDto/routes | DETAIL_AUDIT_REQUIRED |
| FN-X-004 | private dataをpublic artifactへ出さない | projection/visibility | DETAIL_AUDIT_REQUIRED |
| FN-X-005 | mutation auditを維持 | audit helpers/actions | DETAIL_AUDIT_REQUIRED |
| FN-X-006 | Queue retry/idempotencyを維持 | queue consumers | DETAIL_AUDIT_REQUIRED |
| FN-X-007 | existing migration SQLを改変しない | migrations | CURRENT_VERIFIED |
| FN-X-008 | Remote D1 migrationを自動適用しない | deploy docs/scripts | CURRENT_VERIFIED |
| FN-X-009 | legacy importを専用境界外へ広げない | admin import | DETAIL_AUDIT_REQUIRED |
| FN-X-010 | public visibilityはfail-closed対象を維持 | static delivery | DETAIL_AUDIT_REQUIRED |
| FN-X-011 | URL/canonical互換を維持 | public routes | DETAIL_AUDIT_REQUIRED |
| FN-X-012 | production changeはrollback可能にする | routing/deploy | DETAIL_AUDIT_REQUIRED |

---

# 14. Per-function audit template

MIG-0002以降、各rowを必要に応じて次の詳細ブロックへ展開する。

```text
Function ID:
Name:
Users/Roles:
Current UI routes:
Current API/actions:
Inputs:
Outputs:
Auth:
Permissions:
DB reads:
DB writes:
Audit effects:
Queue effects:
R2/KV effects:
Notifications/external effects:
Visibility/privacy:
Error/empty/loading states:
Current tests:
Current known edge cases:
Target owner:
Target UI/API:
Bridge:
Rollback:
Acceptance:
State:
Evidence:
```

## Migration rule

対象画面を作り直す前に、その画面で利用可能なfunction IDを全て列挙する。

例:

```text
/dashboard/edit/[id]
  FN-PER-002
  FN-PER-003
  FN-PUB-005
  FN-ENT-005
  FN-X-002
  FN-X-005
```

実際のmappingはMIG-0007でコードから確定する。例を正本扱いしない。

---

# 15. Redesign parity checklist

各redesign screenごとに確認:

- [ ] CURRENT routeを特定
- [ ] Mock IDを特定
- [ ] associated function IDsを全列挙
- [ ] primary action維持
- [ ] secondary actions維持または明示配置変更
- [ ] permission-dependent controls維持
- [ ] loading state
- [ ] empty state
- [ ] error state
- [ ] permission denied state
- [ ] destructive confirmation
- [ ] mobile/tablet/desktop
- [ ] API/server side-effects parity
- [ ] audit/queue/notification side-effects parity
- [ ] keyboard/focus
- [ ] direct URL/reload/back-forward
- [ ] no private/public data regression

Visual acceptanceだけでチェックを閉じない。

---

# 16. Baseline gaps to close in Phase 0

MIG-0002:

- all page routes
- all Route Handlers/methods
- all Server Action exports + inline actions
- all action callers

MIG-0003:

- all Worker bindings
- routes/custom domains
- Queues/DLQs
- Cron/recovery

MIG-0005:

- all static artifact types
- visibility types/aliases
- repair/fallback behavior

MIG-0006:

- auth/session/account linking
- permission entry points
- owner/event staff rules

MIG-0007:

- all 86 screens → function IDs
- all mock states → CURRENT states
- responsive states

Phase 0 Gateは上記gapが残る限りCLOSEDのままにする。
