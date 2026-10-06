# FlameNode Existing Function Inventory

> Status: Active / Functional parity index
> Last updated: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Architecture: [`README.md`](README.md)
> Progress: [`STATUS.md`](STATUS.md)
> Frontend-exposed capabilities: [`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md)
> Backend optimization: [`BACKEND_OPTIMIZATION.md`](BACKEND_OPTIMIZATION.md)
>
> リデザイン + framework移行で既存機能が欠落しないための索引。
> 詳細は対象domainのledgerだけを読む。

## Mandatory companion rules

`/flamenode-migration` の全iterationでこの索引を読む。

- frontend/UI/routeを触るtaskは `FRONTEND_FEATURES.md` を読む。
- backend/action/API/domain/jobを触るtaskは `BACKEND_OPTIMIZATION.md` の評価ルールを読む。
- 両方に跨るtaskは両方読む。
- 画面存在と機能存在を同一視しない。
- 共通化/効率化はfrontend capabilityとside-effect contractを固定してから評価する。

## Completion invariant

移行完了時:

```text
UNKNOWN required functions = 0
DETAIL_AUDIT_REQUIRED = 0
UNVERIFIED migrated functions = 0
Screens without function mapping = 0
Frontend capabilities without UX-state mapping = 0
Frontend capabilities without backend disposition = 0
Server actions/routes without disposition = 0
Background jobs without disposition = 0
Permission rules without parity evidence = 0
Side effects without parity evidence = 0
Optimization blockers without UX-impact disposition = 0
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
| `FN-PLAT-*`, `FN-API-*`, `FN-JOB-*`, `FN-X-*` | Platform/API/jobs/cross-cutting | [`functions/PLATFORM_API_JOBS.md`](functions/PLATFORM_API_JOBS.md) | 43 |
|  | **Total initial IDs** |  | **130** |

初期frontend-exposed capabilityは89 IDs。
詳細なユーザー観測契約は `FRONTEND_FEATURES.md` を正本とする。

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

画面URL/目的/主操作の正本:

- `docs/design-redesign/ROUTE_INVENTORY.md`
- `docs/design-redesign/PAGE_COVERAGE.md`
- `app/(redesign)/dev/redesign/_catalog.ts`

ユーザーが実際に使える能力の正本:

- `docs/migration/FRONTEND_FEATURES.md`

`MIG-0010` で全86画面をrequired capability IDsへ完全に紐付ける。

## Server Action seed surface

2026-10-06のGitHub code searchでCURRENTのServer Action surfaceを次の2系統として固定した。

```text
src/lib/actions/* の file-level `"use server"` modules: 34 files
app/* の inline `"use server"` pages:                3 files
```

inline確認済み:

```text
app/(auth)/entry/page.tsx
app/(admin)/admin/api-endpoints/page.tsx
app/(admin)/admin/x-id-merges/page.tsx
```

これは**ファイル数のbaseline**であり、Action件数ではない。
`MIG-0003` では34 moduleの全exported async functionと3 inline pageの全actionを関数/caller単位へ展開する。

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
また34+3というファイル数を、実際のaction function数と誤認しない。

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
Pending/async state visible to users
Responsive/deep-link behavior where relevant
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
Frontend observable behaviorは `FRONTEND_FEATURES.md` と矛盾させない。

---

# Screen/function parity rule

画面移行前:

1. `ROUTE_MATRIX.md` のscreen/routeを確認
2. `FRONTEND_FEATURES.md` のcapabilityを確認
3. screenで利用できる全function IDを列挙
4. primary/secondary/destructive actionsを含める
5. permission-dependent controlを含める
6. loading/error/empty/forbidden/pending stateを含める
7. server side effectsを含める

画面DONE条件:

- visual redesign complete
- responsive complete
- loading/error/empty/permission/pending states complete
- associated function IDs = `PARITY_VERIFIED` or `REMOVED_APPROVED`
- permission / DB / audit / Queue / notifications parity confirmed
- direct URL/reload/history behavior confirmed
- backend optimizationでfrontend behaviorが暗黙変更されていない

Visual completionだけなら `UI_DONE_FUNCTIONS_PENDING` として扱う。

---

# Backend optimization rule

backend移行ではCURRENT実装を機械的にコピーしない。

`BACKEND_OPTIMIZATION.md` に従い、対象domainごとに以下を評価する。

- framework concernとbusiness logicの分離
- duplicate auth/permission context
- post-commit effects
- audit/transaction boundary
- revalidation semantics
- Queue/R2/static build side effects
- validation/error contracts
- read model/query duplication
- notification/external sync
- CPU/rows-read/serialization cost

ただし共通化は目的ではない。
意味・permission・failure semanticsが違うものは別実装を維持する。

コード行数は成果指標にしない。
最優先はfrontend capabilityと使い心地の維持。

---

# Phase 0 inventory plan

| Task | Inventory responsibility |
| --- | --- |
| `MIG-0002` | 86 screen/page/route CURRENT baseline + 89 frontend-exposed capability baseline |
| `MIG-0003` | 34 file-level Server Action modules + 3 inline-action pagesを全action function/callerへ展開 + optimization observations |
| `MIG-0004` | all Route Handler HTTP methods + contract/duplication observations |
| `MIG-0005` | Cloudflare topology/bindings/routes/build |
| `MIG-0006` | CPU/1102/request baseline |
| `MIG-0007` | static artifacts/visibility/aliases/repair/fallback |
| `MIG-0008` | auth/session/permission/owner rules |
| `MIG-0009` | Queue/Cron/background job types/effects |
| `MIG-0010` | all 86 screens → frontend capability/function IDs |
| `MIG-0011` | cross-source gap scan, merge duplicates, add missing IDs, UNKNOWN=0, backend optimization/blocker assessment |
| `MIG-0012` | Phase 0 Gate |

## MIG-0011 final optimization assessment

全棚卸し完了後にのみ実施する。

- duplicated implementations that can safely converge
- intentionally separate implementations that should remain separate
- request-time CPU blockers
- architecture exceptions
- features that prevent simplification

効率化の障害となる機能がある場合、`BACKEND_OPTIMIZATION.md` のblocker formatで**frontend側への具体的影響を提示してユーザーへ報告**する。

frontend behavior変更を伴う最適化は自動採用しない。
ユーザー判断まではCURRENT behavior維持をdefaultとする。

Phase 0 Gateまでは初期130 IDが最終数とは限らない。
棚卸しで新規機能が見つかったらIDを追加し、数値をSTATUSへ反映する。
