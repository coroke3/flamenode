# FlameNode Existing Function Inventory

> Status: Active / backend/domain/platform functional parity index
> Last updated: 2026-10-07
> Progress: [`STATUS.md`](STATUS.md)
> Frontend UX: [`FRONTEND_FEATURES.md`](FRONTEND_FEATURES.md)
> Requirements: [`PRODUCT_REQUIREMENTS.md`](PRODUCT_REQUIREMENTS.md)
> Optimization: [`BACKEND_OPTIMIZATION.md`](BACKEND_OPTIMIZATION.md)
> Frontend/Backend全件一覧: [`FEATURE_CATALOG.md`](FEATURE_CATALOG.md)

`FN-*`はbackend/domain/platform側の機能・安全保証の索引。
frontendでユーザーが認識する細かい操作/状態は`UX-*`として`FRONTEND_FEATURES.md`と`frontend/*.md`へ分離する。

```text
UX-* <-> FN-* は many-to-many
```

UI機能数とbackend function数を一致させない。

## Mandatory companion rules

`/flamenode-migration`の全iterationでこの索引を確認する。

- frontend/UI/routeを触る: `CURRENT_ROUTES.md` + `FRONTEND_FEATURES.md` +対象frontend ledger
- backend/action/API/domain/jobを触る: 対象function ledger + `BACKEND_OPTIMIZATION.md` + `CODE_QUALITY.md`; Server Action対象なら `server-actions/README.md`; Route Handler/API対象なら `route-handlers/README.md`; Cloudflare Worker/ingress/binding/build/job対象なら `cloudflare/TOPOLOGY.md`; CPU/1102/request performance対象なら `cloudflare/PERFORMANCE_BASELINE.md`; auth/session/identity/permission/owner対象なら `auth/README.md`; Queue/Cron/background job/retry/DLQ/recovery対象なら `background-jobs/README.md`; static artifact/alias/visibility/fallback/repair対象なら `static-delivery/README.md`
- product/design intentが関係する: `PRODUCT_REQUIREMENTS.md`
- visual UIが関係する: `UI_REFERENCE.md`。`PENDING_HTML`中は新visual designを推測しない
- 画面存在、UX capability、backend functionを同一視しない

## Completion invariant

```text
UNKNOWN required FN functions = 0
DETAIL_AUDIT_REQUIRED = 0
UNVERIFIED migrated FN functions = 0
UX capabilities without FN/backend disposition = 0
Server Actions without disposition = 0
Route Handler methods without disposition = 0
Background jobs without disposition = 0
Permission rules without parity evidence = 0
Side effects without parity evidence = 0
Optimization blockers without UX-impact disposition = 0
```

機能削除は暗黙に行わない。

```text
CURRENT/BASELINE
-> REMOVAL_PROPOSED
-> explicit approval
-> REMOVED_APPROVED
```

## Function states

- `BASELINE_KNOWN`: 存在確認済み
- `DETAIL_AUDIT_REQUIRED`: input/auth/effect/test棚卸し未完
- `CURRENT_VERIFIED`: CURRENT contract棚卸し完了
- `CURRENT_DIVERGENCE`: CURRENT contractは確認済みだが、明示されたTARGET requirementと不一致
- `OBSOLETE`: CURRENT/TARGET双方で独立機能として不要。removal/互換条件を最終監査に記録
- `MERGED_INTO_OTHER`: 独立backend責務を持たず、別FN/domainへ統合
- `TARGET_REDESIGN_REQUIRED`: CURRENTは確認済みだがTARGET service/schema境界の再設計が必要
- `MIGRATION_IN_PROGRESS`: target実装中
- `BRIDGED`: legacy/new共存
- `PARITY_VERIFIED`: target parity確認済み
- `REMOVAL_PROPOSED`: 削除提案中
- `REMOVED_APPROVED`: 明示承認済み削除
- `BLOCKED`: parity判断不能

## TARGET identity priority

MIG-0011以降のTARGETでは、Xに紐づくdomain identityを次の順序で扱う。

- Auth User = authentication/account/security principal。
- Active X = default X-scoped domain principal。acting/content/interaction identityもActive X。
- like / bookmark / save はすべてActive X所有。複数Auth Userが同じXを管理する場合も、そのXのinteraction stateを共有する。
- X-scoped permission = Active X first。D1上でActive Xが当該Auth Userのapproved linkであることを毎回server-sideで検証する。
- approved linked X一覧 = link validation / switch candidate / 明示されたaccount-wide discovery用。inactive Xの権限をActive Xへ暗黙に貸さない。
- 権限が別のlinked Xにしかない場合は、TARGETでは原則として明示的なActive X切替を要求する。admin/systemまたは明示されたaccount-wide flowだけを例外にする。
- banned/terms/site role/Discord delivery/account linking等のaccount/security責務はAuth Userのまま。anonymous view telemetryもActive X化しない。

`auth/README.md` はMIG-0008で検証したCURRENT正本なので、このTARGET定義のために過去事実を書き換えない。CURRENTのall-approved-linked-X permission behaviorとTARGETのActive-X-first behaviorの差は移行時に明示的に解消する。

## Domain ledgers

| IDs | Domain | Detail ledger | Initial count |
| --- | --- | --- | ---: |
| `FN-PUB-*` | Public/discovery/playback | [`functions/PUBLIC.md`](functions/PUBLIC.md) | 27 |
| `FN-AUTH-*`, `FN-PER-*`, `FN-ENT-*` | Auth/personal/entry | [`functions/AUTH_PERSONAL_ENTRY.md`](functions/AUTH_PERSONAL_ENTRY.md) | 23 |
| `FN-MNG-*`, `FN-ADM-*` | Manage/admin | [`functions/MANAGE_ADMIN.md`](functions/MANAGE_ADMIN.md) | 43 |
| `FN-PLAT-*`, `FN-API-*`, `FN-JOB-*`, `FN-X-*` | Platform/API/jobs/cross-cutting | [`functions/PLATFORM_API_JOBS.md`](functions/PLATFORM_API_JOBS.md) | 43 |
|  | **Total initial IDs** |  | **136** |

初期backend/function IDsは136。
初期frontend UX baselineは432で、別ledgerとして管理する。
Phase 0中にどちらも増減し得るが、増減理由をSTATUS/PRへ記録する。

## Baseline evidence surfaces

### UI / routes

CURRENT page route実装・分類は `CURRENT_ROUTES.md` が正本。

```text
app/**/page.tsx routes = 92
VISUAL_SCREEN = 74
COMPAT_REDIRECT = 9
DEV_ONLY = 3
SYSTEM_SURFACE = 6
```

route数とUX/FN数は1:1ではない。compat/dev/systemも、URL・運用・認証等のcontractとして移行時に追跡する。

`docs/design-redesign`や旧mockは正本にしない。

### Server Actions

MIG-0003でfunction-levelまで検証済み。正本は [`server-actions/README.md`](server-actions/README.md)。

```text
file-level "use server" modules: 34
exported async Server Actions: 106
inline actions: 4 across 3 pages
total execution units: 110
unclassified: 0
```

checkerは実コードのmodule exportとledgerを照合し、将来のaction追加漏れを検出する。

### Route Handlers / API

MIG-0004でHTTP method-levelまで検証済み。正本は [`route-handlers/README.md`](route-handlers/README.md)。

```text
app/api/**/route.ts files: 28
HTTP method handlers: 33
unclassified methods: 0
```

checkerは実コードのroute file/method pairとledgerを照合し、将来のAPI追加漏れを検出する。

### Worker / background

MIG-0009でQueue/Cron/background job/retry/DLQ/recovery/idempotency/async stateをcode/tests + read-only Cloudflare実環境で検証済み。正本は [`background-jobs/README.md`](background-jobs/README.md)。

MIG-0008でAuth.js/session/linking/terms/Active X/event-video permission/owner invariantをcode/testsで検証済み。正本は [`auth/README.md`](auth/README.md)。

MIG-0005でCloudflare platform topologyを実環境まで検証済み。正本は [`cloudflare/TOPOLOGY.md`](cloudflare/TOPOLOGY.md)。MIG-0006でCPU/1102/request baselineをWorkers Observabilityから実測済み。正本は [`cloudflare/PERFORMANCE_BASELINE.md`](cloudflare/PERFORMANCE_BASELINE.md)。MIG-0007で25 static targets、artifact families、alias、visibility deny fence、fallback/repairを検証済み。正本は [`static-delivery/README.md`](static-delivery/README.md)。

CURRENT Worker scripts:

```text
flamenode-web
flamenode-fast-jobs
flamenode-content-jobs
flamenode-sync-jobs
```

- MIG-0005: DONE — 4 Worker / 2 Custom Domains / 0 zone Worker Routes / binding / resource / single-build deployment topology CURRENT_VERIFIED
- MIG-0009: Queue/Cron/job type/retry/recovery/side effects

## Per-function required fields

`CURRENT_VERIFIED`へ上げるには最低限:

```text
Function ID
Name / domain meaning
Users/Roles affected
Related UX IDs
Current UI routes
Current API/actions/jobs
Inputs / outputs
Auth / permissions
DB reads / writes
Transaction boundary
Audit effects
Queue effects
R2/KV effects
Notification/external effects
Visibility/privacy
Retry/idempotency/partial failure
User-visible loading/error/pending consequence
Current tests/evidence
Known edge cases
Target owner / API / job
Bridge / rollback
Acceptance
State
```

適用不要項目は`N/A + reason`。

## UX/FN parity rule

画面/機能移行前:

1. `CURRENT_ROUTES.md`でrouteを確認。
2. `FRONTEND_FEATURES.md`の対象ledgerから全`UX-*`を確認。
3. `UX-*`が依存する`FN-*`/action/API/jobを確定。
4. permission/visibility/audit/Queue/notificationを確認。
5. target implementationで同じobservable resultを実現する。
6. backend実装は必要なら再設計するが、UX contractを暗黙変更しない。

Screen DONEにはvisual完成だけでなく、required UXとFN/backend side-effect parityが必要。

## Backend optimization rule

CURRENT実装を新frameworkへ機械翻訳しない。
`BACKEND_OPTIMIZATION.md`と`CODE_QUALITY.md`に従い、以下を評価する。

- framework concern / business rule separation
- auth/permission context duplication
- transaction/audit boundary
- post-commit effects
- Queue/R2/static projection fanout
- revalidation/invalidation semantics
- validation/error taxonomy
- read-model/query duplication
- notification/external sync
- CPU/rows-read/serialization cost
- observability/testability/rollback

ただし共通化自体を目標にしない。意味・permission・failure semanticsが違うものは別実装を維持する。

## Phase 0 inventory plan

| Task | Responsibility |
| --- | --- |
| `MIG-0002` | 当時の86 USER_SCREEN baseline + 432 granular frontend UX baseline + migration quality/source rules |
| `MIG-0003` | all Server Actions/inline actions -> FN/UX mapping + optimization observations |
| `MIG-0004` | all Route Handler methods -> FN/UX mapping + API contract observations |
| `MIG-0005` | Cloudflare topology/bindings/routes/build |
| `MIG-0006` | CPU/1102/request baseline |
| `MIG-0007` | DONE — 25 static targets / artifact families / visibility deny-first / aliases / repair / bounded fallback |
| `MIG-0008` | DONE — auth/session/linking/terms/Active X/owner/permission trust boundaries CURRENT_VERIFIED |
| `MIG-0009` | Queue/Cron/background job types/effects |
| `MIG-0010` | 当時の86 screen分類 + cross-route shells -> UX/FN complete mapping |
| `MIG-0011` | cross-source gap scan, requirement reconciliation, orphan=0, optimization/blocker assessment |
| `MIG-0012` | Phase 0 Gate |

## MIG-0011 final assessment

全棚卸し完了後のみ:

- safely commonizable duplicate implementations
- intentionally separate implementations
- request-time CPU blockers
- architecture exceptions
- legacy compatibility costs
- features preventing simplification
- unresolved documented-vs-current divergence

frontend behavior変更が必要な最適化は`BACKEND_OPTIMIZATION.md`のblocker formatで具体的影響を示し、承認まではCURRENT behavior維持をdefaultとする。

## MIG-0011 backend final audit

Backend / domain / processing の最終監査は [gap-scan/BACKEND_FN_OPTIMIZATION.md](gap-scan/BACKEND_FN_OPTIMIZATION.md) を正本とする。MIG-0011並行作業中は `STATUS.md` をwriter lane間で更新せず、FN state/countは本ファイル配下の4 ledgerからderiveする。
