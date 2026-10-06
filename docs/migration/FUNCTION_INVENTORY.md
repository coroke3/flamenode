# FlameNode Existing Function Inventory

> Status: Active / Functional parity index
> Last updated: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Architecture: [`README.md`](README.md)
> Progress: [`STATUS.md`](STATUS.md)
>
> リデザイン + framework移行で既存機能が欠落しないための索引。
> 詳細は対象domainのledgerだけを読む。

## Completion invariant

移行完了時:

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

機能削除は暗黙に行わない。

```text
BASELINE_KNOWN
→ REMOVAL_PROPOSED
→ explicit approval
→ REMOVED_APPROVED
```

## Function states

- `BASELINE_KNOWN`: 存在確認済み
- `DETAIL_AUDIT_REQUIRED`: input/auth/effect/test棚卸し未完
- `CURRENT_VERIFIED`: CURRENT contract棚卸し完了
- `MIGRATION_IN_PROGRESS`: target実装中
- `BRIDGED`: legacy/new共存
- `PARITY_VERIFIED`: target parity確認済み
- `REMOVAL_PROPOSED`: 削除提案中
- `REMOVED_APPROVED`: 明示承認済み削除
- `BLOCKED`: parity判断不能

## Domain ledgers

| IDs | Domain | Detail ledger | Initial count |
| --- | --- | --- | ---: |
| `FN-PUB-*` | Public/discovery/playback | [`functions/PUBLIC.md`](functions/PUBLIC.md) | 22 |
| `FN-AUTH-*`, `FN-PER-*`, `FN-ENT-*` | Auth/personal/entry | [`functions/AUTH_PERSONAL_ENTRY.md`](functions/AUTH_PERSONAL_ENTRY.md) | 22 |
| `FN-MNG-*`, `FN-ADM-*` | Manage/admin | [`functions/MANAGE_ADMIN.md`](functions/MANAGE_ADMIN.md) | 43 |
| `FN-PLAT-*`, `FN-API-*`, `FN-JOB-*`, `FN-X-*` | Platform/API/jobs/cross-cutting | [`functions/PLATFORM_API_JOBS.md`](functions/PLATFORM_API_JOBS.md) | 41 |
|  | **Total initial IDs** |  | **128** |

毎taskで全ledgerを読まない。対象機能を含むledgerだけを読む。

---

# Baseline evidence surfaces

## UI/screens

既存redesign inventoryで86画面を確認済み。

- Public 16
- Personal 6
- Entry 3
- Manage 12
- Admin 45
- System 4

正本:

- `docs/design-redesign/ROUTE_INVENTORY.md`
- `docs/design-redesign/PAGE_COVERAGE.md`
- `app/(redesign)/dev/redesign/_catalog.ts`

`MIG-0010` で全86画面をfunction IDsへ紐付ける。

## Server Action seed surface

2026-10-06時点で少なくとも34ファイルの`"use server"` surfaceを確認済み。
`MIG-0003` でexport/function/caller単位へ展開し、page内inline actionも探索する。

主な領域:

```text
api-endpoints
manage-video / video/*
youtube-sync
admin / audit / moderation / notification
terms / rules
permission
xid / xid merge
slot
announcement
cost guard
chapter
event / event group / event staff / event template
public visibility repair
static rebuild
```

`src/lib/actions/`だけを見て完了扱いにしない。

## API seed surface

CURRENT `app/api/` top-level 14領域:

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

`MIG-0004` で全`route.ts`をHTTP method単位へ展開する。

## Worker/background seed surface

CURRENT Worker scripts:

```text
flamenode-web
flamenode-fast-jobs
flamenode-content-jobs
flamenode-sync-jobs
```

- `MIG-0005`: Worker/domain/route/binding/build topology
- `MIG-0009`: Queue/Cron/job type/retry/recovery/side effects

---

# Per-function required fields

`CURRENT_VERIFIED`へ上げるには最低限以下を記録する。

```text
Function ID
Name
Users/Roles
Current UI routes
Current API/actions
Inputs
Outputs
Auth
Permissions
DB reads
DB writes
Audit effects
Queue effects
R2/KV effects
Notification/external effects
Visibility/privacy
Loading/error/empty/permission states
Current tests
Known edge cases
Target owner
Target UI/API
Bridge
Rollback
Acceptance
State
Evidence
```

詳細は対象domain ledgerに追記する。

---

# Screen/function parity rule

画面移行前:

1. `ROUTE_MATRIX.md` のscreen/routeを確認
2. screenで利用できる全function IDを列挙
3. primary/secondary/destructive actionsを含める
4. permission-dependent controlを含める
5. server side effectsを含める

画面DONE条件:

- visual redesign complete
- responsive complete
- loading/error/empty/permission states complete
- associated function IDs = `PARITY_VERIFIED` or `REMOVED_APPROVED`
- permission / DB / audit / Queue / notifications parity confirmed
- direct URL/reload/history behavior confirmed

Visual completionだけなら `UI_DONE_FUNCTIONS_PENDING` として扱う。

---

# Phase 0 inventory plan

| Task | Inventory responsibility |
| --- | --- |
| `MIG-0002` | 86 screen/page/route CURRENT baseline |
| `MIG-0003` | all Server Action exports + inline actions |
| `MIG-0004` | all Route Handler HTTP methods |
| `MIG-0005` | Cloudflare topology/bindings/routes/build |
| `MIG-0006` | CPU/1102/request baseline |
| `MIG-0007` | static artifacts/visibility/aliases/repair/fallback |
| `MIG-0008` | auth/session/permission/owner rules |
| `MIG-0009` | Queue/Cron/background job types/effects |
| `MIG-0010` | all 86 screens → function IDs |
| `MIG-0011` | cross-source gap scan, merge duplicates, add missing IDs, UNKNOWN=0 |
| `MIG-0012` | Phase 0 Gate |

Phase 0 Gateまでは初期128 IDが最終数とは限らない。
棚卸しで新規機能が見つかったらIDを追加し、数値をSTATUSへ反映する。
