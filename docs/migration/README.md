# FlameNode Platform Migration

> Status: Active / Migration specification
> Last verified: 2026-10-06
> Verified against commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Source of truth: current code/test, `AGENTS.md`, this document
> Progress: [`STATUS.md`](STATUS.md)
> Multi-agent execution: [`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md)
> Existing-function parity: [`FUNCTION_INVENTORY.md`](FUNCTION_INVENTORY.md)

## Purpose

Next.js + OpenNext中心のCURRENT productionを、1102耐性・将来拡張性・AI実装性・UI/UXを改善しながら段階移行する。

変更自体を目的にしない。CURRENTを維持する方が安全な領域は維持する。

## Goals

- public閲覧からrequest-time SSRを排除する
- public→non-publicのfail-closed visibilityを維持する
- UI/UX redesignをproductionへ移植する
- 既存機能をfunction inventoryで100%追跡する
- business logicをframeworkから分離する
- APIを明示的HTTP boundaryへ移す
- D1/R2/Queueへの既存投資を再利用する
- Claude / Codex / Antigravityのどれでも同じ進捗から継続可能にする
- `flamenode.net` のURL体系を維持する
- route単位でcutover/rollback可能にする

## Non-goals

- D1/R2/Queueを移行のためだけに置換する
- authをUI/frameworkと同時に全面刷新する
- 独自SSG / Islands runtime / router / cache frameworkを作る
- redesignを理由に既存機能を暗黙削除する
- URL/SEO URLを不要に変更する
- Big Bang rewrite
- productionを一度に切り替える

---

# 1. CURRENT

```text
Browser
  |
flamenode.net / www.flamenode.net
  |
flamenode-web
Next.js + OpenNext + Workers Static Assets
  |
D1 / R2 / KV / Queue

Background:
- flamenode-fast-jobs
- flamenode-content-jobs
- flamenode-sync-jobs
```

CURRENTは移行完了までrollback targetとして残す。

原則維持する既存資産:

- D1 canonical model
- Drizzle schema / migrations
- R2 public static projections
- static rebuild Queue / artifacts
- visibility fence / repair
- audit / restore
- permission / owner model
- fast/content/sync Workers
- current public DTO contracts
- current Auth.js behavior until auth phase
- redesign mock / route inventory

---

# 2. TARGET

```text
                         flamenode.net
                              |
                    Cloudflare routing
                              |
             +----------------+----------------+
             |                                 |
          Public                          Private / API
             |                                 |
       flamenode-site                 flamenode-app / api
             |                                 |
 thin visibility gateway             React/Vite + Hono
             |                                 |
      Astro Static Assets                     |
             |                                 |
             +---------------+-----------------+
                             |
                         D1 / R2
                             |
                           Queues
                             |
            +----------------+----------------+
            |                |                |
        fast-jobs       content-jobs       sync-jobs
```

## Public

- Astro static output / SSG
- React integration
- React Islands only for runtime interactivity
- request-time SSRは禁止
- HTML generationはbuild-timeのみ

## Private UI

- React + Vite SPA
- React Router
- TanStack Queryは必要なserver stateのみ
- dashboard / entry / manage / adminはSSRしない

## API

- Hono
- shared Zod/contracts
- bounded synchronous work
- heavy generation/aggregation/syncはQueueへ

## Data / jobs

- D1 canonical
- R2 projection/delivery
- Queue background processing
- existing background Worker splitを原則維持

---

# 3. Non-negotiable migration invariants

- ownerを0人にしない
- authzをUIだけに置かない
- public APIはexplicit DTOのみ
- private dataをpublic projection/build snapshotへ出さない
- visibility fail-closedを弱めない
- auditを失わない
- Queue retry/idempotencyを弱めない
- Remote D1 migrationを自動適用しない
- current URL/canonicalを不用意に変えない
- compatibility bridgeの削除条件を明記する
- function inventoryに未監査必須機能がある状態で移行完了にしない

---

# 4. Same-domain routing / Strangler migration

Worker projectは分割してよいが、外部URLは同じ `flamenode.net` を維持する。

移行中:

```text
flamenode.net
  |
path-specific Worker Routes
  |-- migrated path -> new Worker
  `-- no match       -> CURRENT flamenode-web Custom Domain
```

最終ownershipの概念:

```text
/api/*        -> flamenode-api
/auth/*       -> auth phaseで確定
/dashboard/*  -> flamenode-app
/entry/*      -> flamenode-app
/manage/*     -> flamenode-app
/admin/*      -> flamenode-app
/*            -> flamenode-site
```

Rules:

- route patternはcutover直前に実Cloudflare設定を再確認する
- specific routeから移す
- root-level `/:id` catch-allはPublic migration最後
- Worker Routeを外せばCURRENTへ戻るrollbackを維持する
- production route変更は明示承認時のみ

---

# 5. Public delivery

原則:

```text
Static first
Dynamic by exception
SSR never by default
```

Public requestで禁止:

- React SSR/RSC generation
- D1-heavy projection
- large JSON transform
- build/rebuild
- image transformation proxy
- heavy aggregation

## Visibility gateway

Publicを完全Workerlessにはしない。

理由: static HTMLが古くてもpublic→privateを即時blockするCURRENT guaranteeを維持するため。

Gatewayの責務は最小化する。

1. pathname → entity identity解決
2. visibility state確認
3. blocked/unknownならfail closed
4. allowedならStatic Asset配信

HTML生成禁止。

## Route map

Astro build時にalias→canonical entity mapを生成する。

例:

```json
{
  "/Fv78z0vhDh4": {"type":"video","id":"v_internal"},
  "/v_internal": {"type":"video","id":"v_internal"},
  "/event/PVSF2026S": {"type":"event","id":"PVSF2026S"}
}
```

Gatewayでalias解決のためにD1 lookupを行わない。

PoC CPU target:

- p50 < 1.5ms
- p95 < 3ms
- p99 < 5ms
- 1102 = 0

閾値未達なら原因を分析し、都合よくgateを緩めない。

---

# 6. Astro / React boundary

Astroの責務:

- route generation
- SSG
- HTML/head/SEO/OGP
- asset bundling
- React component integration
- Islands orchestration

Astroへbusiness logicを置かない。

SSGへ入れるstable public content:

- title / creator / description
- music / credit
- event metadata
- thumbnail / canonical / SEO / OGP
- stable public chapters/content
- first paintに有効なinitial lists

Island/APIへ残すdynamic content:

- login state
- like/save
- view tracking/count
- viewer/private overlay
- live slot count/state
- high-frequency trending
- authenticated/private data
- mutations
- polling/WebSocket candidate

高頻度値だけの変更でsite rebuildを起こさない。

---

# 7. Public build data

Astro buildからD1 projectionを再実装しない。

```text
D1
 |
existing static rebuild Queue
 |
content-jobs
 |
safe public projections
 |
private R2 build snapshot
 |
Astro build
```

推奨build input bucket:

```text
flamenode-public-build
```

用途:

```text
videos/{id}.json
users/{id}.json
events/{id}.json
global/*.json
routes.v1.json
build-meta.v1.json
```

build credentialはread-only / least privilege。

## Rebuild coordination

コンテンツ更新ごとにsite buildを起こさない。

Conceptual generation state:

```text
desired_generation
snapshot_generation
building_generation
deployed_generation
dirty_since
last_triggered_at
last_deployed_at
build_id
last_error
```

- change -> desired++
- 30〜60秒coalesce
- snapshot ready -> site build trigger
- build中の更新はdesiredへ蓄積
- completion時 deployed < desiredなら再build

Code BuildとContent Buildを分離する。

- Code Build: code-related workers/apps + smoke
- Content Build: site only + smoke

content更新でfast/sync Workerを再deployしない。

---

# 8. Private SPA / shared UI

対象:

- `/dashboard`
- `/entry`
- `/manage`
- `/admin`
- SEO不要なprivate/system surfaces

Rules:

- Static SPA shell
- Hono API経由でdata/mutation
- server-side authz再検証
- private dataをpublic buildへ流さない
- direct URL/reload/back-forwardをacceptanceに含める

## Shared design system

Public/PrivateでReact UIを二重実装しない。

Target:

```text
packages/ui/
  primitives/
  typography/
  navigation/
  forms/
  feedback/
  data-display/
  video/
  event/
  user/
```

`packages/ui`では原則禁止:

- Next routing imports
- Server Actions
- Hono/Astro imports
- direct D1/R2 access

FlameNode Sans、theme、spacing、responsive behaviorをtoken化する。

Design visual sourceは `docs/design-redesign/`。
Functional parity sourceは `FUNCTION_INVENTORY.md` とCURRENT code/test。

---

# 9. API / domain migration

Server ActionをHonoへcopyしない。

```text
CURRENT Server Action / Route Handler
            |
            v
framework-neutral domain service
            ^
            |
     +------+------+
     |             |
legacy Next     Hono route
```

`packages/domain`で禁止:

- Next/Astro/Hono framework imports
- `"use server"`
- `revalidatePath`
- framework request/cookie/navigation APIs
- browser APIs

`packages/contracts`:

- Zod input/output
- explicit error contracts
- domain-scoped shared types

Mutation parityはDBだけで判断しない。

確認対象:

- permission
- DB writes
- audit
- Queue
- R2/KV
- notifications/external effects
- client refresh semantics

Exact dispositionは `API_MATRIX.md`。

---

# 10. Auth

Auth migrationは後段。

それまではCURRENT Auth.js behaviorを維持する。

必須parity:

- Discord OAuth
- existing users/accounts/sessions
- custom account linking
- banned/role/active-X behavior
- origin/callback behavior
- logout/login
- permission integration
- CPU/security
- rollback

自前auth protocolを新規実装しない。

---

# 11. Media / upload

- public requestで画像変換proxyを原則行わない
- static/R2/direct deliveryを優先
- transformationが必要ならbackground artifact化を優先
- large upload bodyをAPI Workerでbufferしない
- permission/authorization後にdirect-to-R2 uploadを優先

---

# 12. Migration phases

進捗・task ID・ownerは `STATUS.md` が正本。

## Phase 0 — Baseline / inventory

分割:

- `MIG-0001` multi-agent migration framework
- `MIG-0002` screen/route inventory
- `MIG-0003` Server Action inventory
- `MIG-0004` Route Handler/API inventory
- `MIG-0005` Cloudflare topology/bindings/jobs
- `MIG-0006` CPU/1102/request baseline
- `MIG-0007` static artifact/visibility baseline
- `MIG-0008` auth/session/permission baseline
- `MIG-0009` background Queue/Cron/job inventory
- `MIG-0010` 86 redesign screens → function mapping
- `MIG-0011` function inventory consolidation / gap scan
- `MIG-0012` Phase 0 Gate

Gate:

- required CURRENT functions fully inventoried
- all 86 screens mapped to function IDs
- all Server Actions/inline actions disposed
- all Route Handler methods disposed
- all background jobs disposed
- Cloudflare baseline fixed
- CPU/1102 baseline fixed
- visibility/auth guarantees fixed
- rollback target fixed
- production behavior unchanged

## Phase 1 — Repository boundaries

Create only the boundaries required by the phase:

```text
apps/site
apps/app
apps/api
packages/ui
packages/domain
packages/contracts
packages/public-data
```

Do not move CURRENT tree wholesale.

## Phase 2 — Design System

Convert redesign proposal into reusable React UI/tokens.

Gate: responsive + accessibility + function preservation.

## Phase 3 — Domain extraction

Extract framework-neutral business logic while CURRENT path still calls the same services.

Gate: behavior / permission / DB / audit / Queue parity.

## Phase 4 — Public PoC

Representative:

- static page
- video
- user
- event
- React Island
- route map
- visibility gateway

Gate: no SSR, fail-closed, SEO/OGP parity, CPU/build targets.

## Phase 5 — Public migration

Order:

1. fixed/static
2. events
3. groups
4. users
5. list/search/recommend/trending
6. root/top
7. `/:id` catch-all last

## Phase 6 — Hono API

Order: low-risk reads → low-risk mutations → video → event/slot → user/X/admin → benchmark/gate.

## Phase 7 — Private SPA

Order: dashboard reads → dashboard mutations → entry → manage → admin.

Screen DONE requires associated function IDs parity verified.

## Phase 8 — Auth

Compatibility PoC and explicit production cutover proposal only after previous boundaries are stable.

## Phase 9 — Next/OpenNext retirement

Only after:

- all production routes disposed
- no required legacy actions/routes remain
- auth cutover complete
- observation/rollback window complete
- CPU/1102 stable
- docs consolidated

Legacy removal is separate from migration implementation PRs.

---

# 13. Acceptance gates

## Public

- request-time SSR = 0 by default
- fail-closed visibility
- alias correctness
- SEO/canonical/OGP parity
- static HTML delivery
- gateway CPU target met
- 1102 = 0

## API

Initial CPU targets:

- simple reads p95 < 5ms
- normal mutations p95 < 8ms
- auth-heavy p95 < 9ms
- 1102 = 0

Use real Cloudflare metrics for production gates.

## Build

Initial PoC targets:

- full Astro build < 60s ideal
- < 120s acceptable
- public content reflection < 90s target
- generation loss = 0
- Static Assets count with Free-tier headroom

If exceeded, analyze input/page count/build strategy before inventing custom SSG.

## UI

- 86-screen coverage maintained
- desktop/tablet/mobile
- keyboard/focus
- loading/error/empty/permission states
- permission/server effects parity
- no feature deletion without explicit approval

---

# 14. Rollback

Route migration:

- remove new Worker Route → CURRENT `flamenode-web`

API:

- keep legacy endpoint until client/new endpoint parity is stable

UI:

- retain old route during migration window when practical

DB:

- do not introduce destructive migration solely for framework migration

Auth:

- CURRENT auth remains rollback path until compatibility is proven

---

# 15. Document ownership

| Document | Owns |
| --- | --- |
| `README.md` | architecture/invariants/phases/gates |
| `AGENT_PROTOCOL.md` | Claude/Codex/Antigravity execution/loop contract |
| `STATUS.md` | current task/owner/progress/blockers |
| `FUNCTION_INVENTORY.md` | existing capability/parity/removal ledger |
| `ROUTE_MATRIX.md` | route/screen migration disposition |
| `API_MATRIX.md` | Server Action/Route Handler/API disposition |
| `docs/design-redesign/*` | visual/information architecture proposal |
| code/test/config | exact implementation truth |

Do not duplicate rapidly changing implementation details across multiple Markdown files.
