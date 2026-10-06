# FlameNode API / Server Migration Matrix

> Status: Active / Server migration source of truth
> Last updated: 2026-10-06
> Architecture: [`README.md`](README.md)
> Progress: [`STATUS.md`](STATUS.md)
>
> Server Action / Route Handler / server-only helperを、framework-neutral domain service + Hono APIへ移すための契約表。

## Columns

- `CURRENT`: 現在のServer Action / Route Handler / helper
- `DOMAIN`: 移行先domain service
- `TARGET`: Hono endpointまたは継続job
- `Permission`: 維持する認可契約
- `Effects`: D1 / audit / Queue / R2等の副作用
- `State`: NOT_INVENTORIED / READY / IN_PROGRESS / REVIEW / DONE / BLOCKED
- `Task`: `STATUS.md`のMIG task

## Domain summary

> MIG-0002で現行コードを完全棚卸しする。以下は移行単位を固定するための初期分類。

| Domain | CURRENT examples | TARGET | Key invariants | State | Task |
| --- | --- | --- | --- | --- | --- |
| video | manage-video Server Actions / video Route Handlers | `packages/domain/video/*` + Hono | ownership/event permission、audit、static rebuild | NOT_INVENTORIED | MIG-0304 / 0603 |
| event | event/admin actions/routes | `packages/domain/event/*` + Hono | owner最低1人、visibility、audit | NOT_INVENTORIED | MIG-0305 / 0604 |
| slot | slot actions/routes | `packages/domain/slot/*` + Hono | auth、枠状態、一意性、notification | NOT_INVENTORIED | MIG-0305 / 0604 |
| user/X | X ID/user actions/routes | `packages/domain/user/*` + Hono | approval/public-listable、privacy | NOT_INVENTORIED | MIG-0306 / 0605 |
| permissions | permission/admin actions | shared permission core + Hono boundary | existing access-context parity | NOT_INVENTORIED | MIG-0306 / 0605 |
| admin | admin actions/routes | domain-specific Hono endpoints | admin auth、audit | NOT_INVENTORIED | MIG-0306 / 0605 |
| YouTube sync | admin actions + jobs | Hono trigger + existing jobs | quota、dedupe、background processing | NOT_INVENTORIED | MIG-0306 / 0605 |
| public reads | public Route Handlers/loaders | Astro/R2 or Hono | explicit DTO、visibility | NOT_INVENTORIED | MIG-050x / 0601 |
| auth | NextAuth/Auth.js | later compatibility target | sessions/accounts/linking | NOT_INVENTORIED | MIG-080x |

## Endpoint-level template

MIG-0002以降、各処理は以下を記録する。

```text
ID:
Domain:
Current file/export:
Current invocation:
Current request/input:
Current response/result:
Current permission/auth:
Current DB reads:
Current DB writes:
Audit side effect:
Queue side effect:
R2/KV side effect:
External side effect:
Current tests:

Target domain service:
Target Hono route:
Target contract:
Target tests:
Compatibility bridge:
Bridge removal condition:
Rollback:
Task:
State:
```

## Migration rule

禁止:

```text
Server Action
  -> copy business logic
  -> Hono
```

必須:

```text
Current Server Action
      |
      v
framework-neutral domain service
      ^
      |
 +----+-----+
 |          |
legacy    Hono
Next      route
```

legacyとHonoが同じdomain serviceを呼ぶ期間を作り、parityを固定する。

## Domain service constraints

`packages/domain` から禁止:

- Next imports
- Hono imports
- Astro imports
- React Router imports
- `revalidatePath`
- `redirect`
- `cookies()` 等framework request API
- browser API

request contextは明示dependencyとして渡す。

例:

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

- UI移行時にpermission modelを作り直さない。
- Server Action経路とHono経路のpermission decisionを同一helper/domain coreへ寄せる。
- access contextとDB direct経路の既存parity testを壊さない。
- owner=0を作らない。
- admin-only処理をclient判定だけで開かない。

## Side-effect rule

mutation parityは「DBが同じ」だけで完了ではない。

最低限確認:

- D1 state
- audit event
- Queue enqueue/reason
- R2/static rebuild dirty state
- notifications
- external API calls
- redirect/revalidationに依存していたclient refresh semantics

Nextの`revalidatePath()`はHonoへコピーせず、SPA query invalidationまたはpublic build dirtyへ意味を分解する。

## Error contract

新APIはerrorをdomain単位で明示する。

例:

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

HTTP status / public message / internal detailを分離する。
既存clientが依存するerror behaviorはparityを確認する。

## CPU rule

HTTP APIで避ける:

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
