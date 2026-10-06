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
