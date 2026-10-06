# FlameNode Platform Migration

> Status: Active / Migration specification
> Last verified: 2026-10-06
> Baseline commit: `99591f7b3387b6b33d113f2685d6b31e38085fdc`
> Production domain: `flamenode.net`, `www.flamenode.net`
>
> Purpose: Next.js + OpenNext中心の現行Webを、1102耐性・将来拡張性・AI実装性を改善しながら段階移行する。
>
> This document is the migration source of truth.
> DB schema、権限、現行behaviorはコード/testが上位。

## 0. Goal / Non-goal

### Goal

- Cloudflare Workers FreeのHTTP CPU 10ms制約に対し、public閲覧からrequest-time SSRを排除する。
- public→private変更時のfail-closed visibilityを維持する。
- UI/UX redesignをproductionへ移植する。
- business logicをframeworkから分離する。
- APIを明示的なHTTP boundaryへ移す。
- public / private UI / API / background jobsを実行特性で分離する。
- AI agentが一般的なAstro / React / Hono / Cloudflareパターンとして理解できる構成にする。
- 同一 `flamenode.net` URL体系を維持する。
- Big Bang rewriteを避け、route単位でrollback可能にする。

### Non-goal

- D1/R2/Queueを新技術へ置換すること
- authを同時に全面刷新すること
- 新しい独自SSG / Islands runtime / router / cache frameworkを作ること
- redesignを理由に機能を削ること
- URL変更・SEO URL再設計
- productionを一度に全切替すること
- 技術変更そのものを目的にすること

---

# 1. CURRENT architecture

```text
Browser
  |
flamenode.net / www.flamenode.net
  |
flamenode-web
Next.js + OpenNext
  |
D1 / R2 / KV / Queue

Background:
- flamenode-fast-jobs
- flamenode-content-jobs
- flamenode-sync-jobs
```

現行productionでは `flamenode-web` がCustom Domainを保持する。

維持する既存資産:

- D1 authoritative model
- Drizzle schema / migrations
- R2 public static JSON projection
- `static_rebuild_queue`
- `static_artifacts`
- visibility fence / blocked manifest
- audit / restore model
- permission / owner model
- fast/content/sync Workers
- current public DTO contracts
- current API behavior until explicitly migrated
- redesign mock/inventory

既存static rebuildは「Next.js buildとは別のpublic artifact generation」として成立している。
新基盤はこれを置換せず利用する。

---

# 2. TARGET architecture

```text
                         flamenode.net
                              |
                    Cloudflare routing
                              |
             +----------------+----------------+
             |                                 |
         Public Site                       Private / API
             |                                 |
       flamenode-site                     flamenode-app/api
             |                                 |
 thin visibility gateway                React/Vite + Hono
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

## Target stack

### Public

- Astro
- static output / SSG
- React integration
- React Islands only where runtime interactivity is required
- request-time SSRは禁止
- HTML generationはbuild-timeのみ

### Private UI

- React
- Vite
- SPA
- React Router
- TanStack Queryはserver stateが必要な箇所のみ
- dashboard/admin/manage/entryはSSRしない

### API

- Hono
- explicit HTTP routes
- Zod/shared contracts
- minimal synchronous CPU
- heavy generation/aggregationはQueueへ

### Data / Jobs

- D1 authoritative
- R2 projection
- Queue background processing
- existing Worker splitを原則維持

---

# 3. Same-domain Worker routing

Workerプロジェクトは分割してよいがURLは維持する。

## Migration period

```text
flamenode.net
  |
Worker Routes
  |-- selected migrated paths -> new Worker
  |
  `-- no match -> existing flamenode-web Custom Domain
```

現行 `flamenode-web` をorigin/fallbackとして残す。

## Final route ownership

概念例:

```text
/api/*        -> flamenode-api
/auth/*       -> auth owner decided in auth phase
/dashboard/*  -> flamenode-app
/entry/*      -> flamenode-app
/manage/*     -> flamenode-app
/admin/*      -> flamenode-app
/*            -> flamenode-site
```

実route patternはcutover直前にCloudflare実設定と競合確認後に確定する。

Rule:

- Routeを推測でproductionへ追加しない。
- production route変更は明示依頼時のみ。
- specific routeを先に移し、root-level `/:id` はPublic移行の最後。
- rollbackはWorker Routeを外して旧 `flamenode-web` へ戻せる状態を維持する。

---

# 4. Public delivery

## 原則

```text
Static first
Dynamic by exception
SSR never by default
```

Public requestで禁止:

- React SSR
- RSC generation
- D1-heavy projection
- large JSON transformation
- build/rebuild
- image transformation proxy
- aggregate generation

## Visibility gateway

完全Workerレスにはしない。

理由:
現行FlameNodeはpublic→non-public変更時にvisibility fenceで古いartifactを即座にblockする。
Pure Static Assetsだけでは次buildまで古いHTMLを公開し得る。

gatewayの責務:

1. pathnameからpublic entityを特定
2. visibility stateを確認
3. blockedならfail closed
4. allowedならStatic Assetを返す

HTML生成は禁止。

### Route map

Astro build時にroute/entity対応を生成する。

```json
{
  "/Fv78z0vhDh4": {"type":"video","id":"v_internal"},
  "/v_internal": {"type":"video","id":"v_internal"},
  "/event/PVSF2026S": {"type":"event","id":"PVSF2026S"},
  "/user/example": {"type":"x_user","id":"example"}
}
```

目的:

- YouTube ID aliasとinternal IDを同じvisibility entityへ結び付ける。
- gatewayでD1 alias lookupをしない。
- route mapはbuild artifactとしてversion管理/検査する。

### Fail closed

以下ではpublic detailを返さない。

- enforce modeでmanifest unavailable
- malformed route map
- blocked entity
- visibility identityを安全に解決できない対象

## CPU acceptance

PoC gate:

- p50 < 1.5ms
- p95 < 3ms
- p99 < 5ms
- 1102 = 0

実測が満たせない場合は設計を見直し、閾値を都合よく緩めない。

---

# 5. Astro / React Islands

Astroは以下だけを担当する。

- routing
- SSG
- HTML/head/SEO generation
- framework component integration
- Islands orchestration
- asset bundling

Astroをbusiness logic layerにしない。

`packages/ui` のReact componentをAstroから利用する。

HTMLへ入れるもの:

- title
- creator
- description
- music / credit
- event metadata
- thumbnail / canonical
- SEO / OGP metadata
- stable public chapters / public static content
- initial list/shelf where SEO/first paintに有効

Island / APIへ残すもの:

- login state
- like / save
- view tracking/count
- viewer/private overlay
- slot live count
- realtime state
- high-frequency trending
- authenticated/private data
- mutations
- polling/WebSocket candidate

高頻度値が変わるだけでAstro buildを発火しない。

---

# 6. Build data source

Astro buildからD1へ直接projection queryを書かない。

```text
D1
 |
existing static rebuild queue
 |
content-jobs
 |
safe public projection
 |
R2 build snapshot
 |
Astro build
```

public HTMLとR2 JSONでprojection logicを二重実装しない。

専用のread-only build inputを持つ。

推奨:

```text
flamenode-public-build (private R2)
```

例:

```text
videos/{id}.json
users/{id}.json
events/{id}.json
global/top.json
routes.v1.json
build-meta.v1.json
```

Build credentialはread-only / least privilege。

---

# 7. Content build coordination

コンテンツ変更ごとにbuildしない。

概念state:

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

保存先は既存運用との整合を確認してphase内で決める。

Coalescing:

- content更新 -> desired_generation++
- 30〜60秒 debounce
- snapshot ready後にsite buildを1回trigger
- build中の追加更新はdesiredへ積む
- completion時 `deployed < desired` ならもう1回trigger

Build種類:

- Code Build: site + app/api + jobs + smoke
- Content Build: site only + smoke

content更新でfast/sync Workerを再deployしない。

---

# 8. Private SPA

対象:

- `/dashboard`
- `/entry`
- `/manage`
- `/admin`
- private/system surfaces that do not require public SEO

Rule:

- React + Vite SPA
- request-time SSR無し
- UI routingはReact Router
- API accessはHono
- auth/permissionはAPI/server境界で必ず再検証
- private dataをpublic R2 projectionへ混ぜない

Design source:

1. `docs/design-redesign/DESIGN_PRINCIPLES.md`
2. `docs/design-redesign/UX_AUDIT.md`
3. `docs/design-redesign/NAVIGATION.md`
4. `/dev/redesign`
5. `docs/design-redesign/PAGE_COVERAGE.md`
6. `docs/design-redesign/DECISIONS.md`

Executable route inventory:

`app/(redesign)/dev/redesign/_catalog.ts`

redesign mockはUI仕様の参考。
permission / auth / side effect / API / DB / validation / workflow semanticsは現行production code/testが正本。

---

# 9. Shared UI / Design System

推奨boundary:

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

`packages/ui` では原則禁止:

- `next/link`
- `next/navigation`
- Server Action
- Hono import
- Astro-specific API
- direct D1/R2 access

link/navigationはadapterまたはpropsで注入する。

FlameNode Sans、theme、spacing、responsive behaviorはtoken化する。

---

# 10. API / Domain migration

Server Actionを直接Honoへ書き換えない。

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

`packages/domain` に含める:

- business rule
- permission decision core where framework-independent
- mutation orchestration
- explicit dependencies

禁止:

- `"use server"`
- `revalidatePath`
- `next/navigation`
- Astro
- Hono Request/Context
- browser API

`packages/contracts`:

- Zod schemas
- request DTO
- response DTO
- error contract
- shared discriminated unions

巨大な単一RPC typeへ寄せずdomain単位で分割する。

---

# 11. Auth migration

Authは後段。

既存Auth.js/NextAuthをproduction source of truthとして維持する。

理由:

- Discord OAuth
- database session
- Drizzle adapter
- custom account linking
- banned/role/active-X handling
- origin validation
- callbacks
- existing session compatibility

Auth PoC acceptance:

- existing users/accounts/sessions compatibility
- Discord account linking parity
- cookie/session parity
- banned/permission behavior parity
- logout/login callback parity
- Cloudflare Free CPU acceptance
- rollback可能

互換証明前にproduction authを置換しない。
自前認証protocolを新規実装しない。

---

# 12. Images / Uploads

Public requestで画像変換proxyを原則行わない。

- static/public imageはdirect/static/R2
- remote thumbnailは可能な限り生成済みURLを利用
- 変換が必要ならbackground generation + cached artifactを優先

大容量bodyをAPI Worker経由でbufferしない。

推奨:

```text
Browser
  |
API: permission + upload authorization
  |
direct upload to R2
```

---

# 13. Migration phases

## Phase 0 — Baseline

記録:

- current commit
- current Worker/domain/routes
- current bindings
- CPU / 1102 baseline
- static artifact health
- visibility fence health
- auth/session contract
- route inventory
- design coverage

Gate:

- baseline tests pass
- rollback target固定
- production route変更無し

## Phase 1 — Repository boundaries

追加候補:

```text
apps/site
apps/app
apps/api
packages/ui
packages/domain
packages/contracts
packages/public-data
```

既存Nextコードを大規模移動しない。

Gate:

- current production build unaffected
- new packages compile independently
- no behavior change

## Phase 2 — Design System

`/dev/redesign`からshared React UIをproduction-ready componentへ移す。

Gate:

- 1440 / 1024 / 768 / 390 acceptance
- Light/Dark parity where required
- accessibility baseline
- no feature deletion

## Phase 3 — Domain extraction

Server Action / Route Handlerのbusiness logicを順次framework-neutral化する。

Gate:

- legacy path uses same new domain service
- behavior parity test
- DB side-effect parity
- audit parity

## Phase 4 — Public PoC

対象:

- `/about`
- `/rules`
- video 1件
- user 1件
- event 1件

実装:

- Astro static build
- React Island
- SEO/OGP
- route map
- visibility gateway

Gate:

- static route parity
- fail-closed visibility
- no SSR
- gateway p99 CPU < 5ms
- 1102 = 0
- build time acceptable
- generated file count acceptable

## Phase 5 — Public route migration

順序:

1. fixed/static pages
2. `/event/*`
3. `/groups/*`
4. `/user/*`
5. list/search/recommend surfaces
6. root/top
7. `/:id` video catch-all last

RouteごとにWorker Routeでnew pathへ切替。

## Phase 6 — Hono API

domainごとに移行:

- low-risk reads
- low-risk mutations
- video
- event
- slot
- user/X
- admin
- high-risk permission routes last

## Phase 7 — Private SPA

順序:

1. dashboard read-only surfaces
2. dashboard mutation surfaces
3. entry
4. manage
5. admin

## Phase 8 — Auth

compatibility PoC後のみ切替。

## Phase 9 — Next/OpenNext retirement

削除条件:

- all production routes mapped
- no required Server Actions remain
- auth cutover complete
- rollback window completed
- no OpenNext-only scheduled/runtime dependency
- production smoke stable
- CPU/1102 metrics stable
- docs updated

OpenNext/Next依存削除は独立PRで行う。

---

# 14. Rollback

## Route migration

Worker Routeを外し、現行 `flamenode-web` Custom Domainへ戻す。

## API

Hono cutover前はlegacy endpointを残す。
client切替とserver削除を同一PRにしない。

## UI

new UI route failure時はold routeへ戻せる期間を確保する。

## DB

移行だけを理由に破壊migrationを行わない。
新旧経路共存期間中はschema compatibilityを維持する。

---

# 15. Acceptance gates

## Public

- no request-time SSR
- visibility fail-closed
- route alias correctness
- SEO / canonical / OGP
- Static Asset served for HTML
- gateway p99 CPU < 5ms target
- 1102 = 0

## API

初期target:

- simple reads p95 < 5ms
- normal mutation p95 < 8ms
- auth-heavy p95 < 9ms
- 1102 = 0

CPUは実Cloudflare metricsで判断する。
ローカル値だけでproduction gateを通さない。

## Build

初期PoC target:

- Astro full build < 60s ideal
- < 120s acceptable
- public content反映 < 90s target
- generation loss = 0
- Static Assets file countはFree制限に十分余裕を持つ

閾値超過時はbuild input / page count / generation strategyを分析する。
独自SSGへ即座に逃げない。

## UI

- redesign coverage維持
- desktop/tablet/mobile
- keyboard/focus
- loading/error/empty/permission states
- production semantics parity

---

# 16. `/flamenode-migration` execution contract

標準入口は `.claude/commands/flamenode-migration.md`。

1 invocationで **1つのREADY taskだけ** 実行する。

開始時:

1. `AGENTS.md`
2. `docs/AI_CONTEXT.md`
3. この文書
4. `docs/migration/STATUS.md`
5. 現在タスクに必要なmatrix
6. 対象コード/test

終了時:

- task state更新
- validation結果更新
- CURRENT/TARGET/BRIDGE/REMOVABLEの変化を記録
- next READY taskを明示
- BLOCKED理由を明示

`/loop` と併用してもこの契約を変えない。

---

# 17. Agent implementation rules

必ずする:

- currentとtargetを区別する
- code/testを正本にする
- phase内だけ変更する
- new pathとlegacy pathのparity testを作る
- rollback方法を書く
- compatibility layerの削除条件を書く
- Cloudflare binding/routeを実設定と照合する
- framework-neutral business logicを優先する

してはいけない:

- 先に旧Nextを削除
- authをついでに書き直す
- UIだけ見てpermissionを再設計
- Queue/R2を全面置換
- 独自Island runtime
- 独自SSG
- public HTMLをrequest中に生成
- public projectionへprivate fieldを追加
- buildごとに全Workersを再deploy
- mainへ直接push
- production操作を無断実行

---

# 18. Documentation ownership

- `README.md`: architecture / invariants / phases / gates / rollback
- `STATUS.md`: 現在地・明示進捗・次READY
- `ROUTE_MATRIX.md`: route単位のmigration contract
- `API_MATRIX.md`: server action/API単位のmigration contract
- `docs/design-redesign/*`: UI/UX proposal / acceptance input
- code/test/config: exact implementation truth

Markdownへ固定してよい:

- architecture boundary
- invariants
- phase order
- acceptance gate
- rollback policy
- ownership rule

コード/configを正本にする:

- binding name
- exact schema columns
- exact route list
- environment values
- API field details
- current counts

---

# 19. Agent start checklist

migration taskを受けたagentは実装前に以下を判定する。

1. Current Phase
2. Current Task ID
3. CURRENT behavior
4. TARGET behavior
5. 触るroute/domain
6. 維持すべきtest/contract
7. visibility/auth/permission影響
8. rollback
9. production操作要否

不明なら推測で実装範囲を広げず、STATUSをBLOCKEDにする。
