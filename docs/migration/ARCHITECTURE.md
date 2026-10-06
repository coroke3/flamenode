# Migration Architecture

> Status: Active target architecture
> Current production remains the baseline until each strangler cutover task passes acceptance.

## Target

```text
flamenode.net
  -> Cloudflare routing
     -> flamenode-site
        -> thin visibility gateway
        -> Astro Static Assets
     -> flamenode-app
        -> React/Vite SPA
        -> Hono API
     -> flamenode-fast-jobs
     -> flamenode-content-jobs
     -> flamenode-sync-jobs
        -> D1 / R2 / Queues
```

`flamenode-web` は移行中のみ旧 Next/OpenNext origin として残す。

## Public delivery

原則: **SSRしない。HTMLをrequest中に生成しない。公開可否だけrequest時に確認する。**

`flamenode-site` の request path:

```text
pathname
  -> generated route guard map
  -> { type, entityId }
  -> visibility manifest
     -> blocked/unavailable(enforce): 404/410/unavailable
     -> public: ASSETS.fetch(request)
```

request path では React SSR、D1 projection、public JSON normalize、metadata生成を行わない。

### Route guard map

生成物: `generated/public-route-map.json`

```json
{
  "/Fv78z0vhDh4": { "type": "video", "id": "v_xxxxx" },
  "/v_xxxxx": { "type": "video", "id": "v_xxxxx" },
  "/event/PVSF2026S": { "type": "event", "id": "PVSF2026S" },
  "/user/foo": { "type": "x_user", "id": "foo" }
}
```

作品の internal id / YouTube id alias の双方を canonical entity へ解決する。route map に存在しない path を勝手に public 扱いしない。manifest v1 を最初は維持し、CPU/size の実測が閾値を超えた場合だけ per-entity R2 marker (`visibility/{type}/{id}` + `head()`) を別 work item で検討する。

## Public static/dynamic boundary

- `/about`, `/rules`: full SSG
- `/`, `/[id]`, `/event/[id]`, `/event/[id]/release`, `/user/[id]`: SEO/本文は SSG、live state / interactions は island/API
- `/event/[id]/slots`: header/SEO は SSG、slots 本体は island/API
- `/list`: 初期一覧/SEO は SSG、search/filter/pagination は island
- `/recommend`, `/trending`: shell/初期値は SSG、最新値は island/API

view/like/save など HTML/SEO を変えない live state は content build を発火させない。

## Public build data

新規 private R2 bucket: `flamenode-public-build`。

```text
video/{id}.json
user/{id}.json
event/{id}.json
groups/{id}.json
routes.v1.json
build-meta.v1.json
```

既存 generator の safe public DTO / projection を再利用し、Astro 用 D1 query を二重実装しない。build credential はこの bucket の read-only に限定する。

## Build generation state

D1 に migration 専用1行 state を持たせる。

```text
desired_generation
snapshot_generation
building_generation
deployed_generation
dirty_since
last_triggered_at
last_deployed_at
build_uuid
last_error
```

複数更新は coalesce する。build 完了時に `deployed_generation < desired_generation` なら次 build を要求する。content update は site のみ build/deploy し、jobs worker を再deployしない。

## Private / API

- `apps/app`: React + Vite SPA
- `apps/api`: Hono
- `packages/ui`: framework-neutral React UI。`next/link` / `next/navigation` を禁止
- `packages/domain`: business logic
- `packages/contracts`: API DTO/schema
- `packages/public-data`, `packages/db`, `packages/auth`: shared boundaries

Server Action は直接一括 rewrite せず、まず Domain Service を抽出する。

```text
legacy Next action -> Domain Service <- Hono endpoint
```

Auth は最後の独立フェーズ。既存 NextAuth/Auth.js の session / Drizzle Adapter / account linking / origin validation / role / banned / active X ID / callback / logging を contract 化し、互換性を証明してから Private SPA を切り替える。

## Strangler migration

Worker Route を既存 Custom Domain Worker の前段へ段階的に置き、未移行 path は既存 `flamenode-web` へ fallback する。public の明確な prefix から移し、catch-all の `/[id]` は public 最後。Private/API は specific route で分離する。

## PoC gates

Visibility gateway は production cutover 前に実ログで評価する。

- p50 CPU < 1.5ms
- p95 CPU < 3ms
- p99 CPU < 5ms
- 1102 = 0
- public→private 後、古い HTML/static artifact が存在していても非公開
- manifest unavailable/malformed in enforce は fail closed

5ms gate を満たさない場合は route cutover を止め、manifest lookup strategy を再評価する。
