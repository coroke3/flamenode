# FlameNode 複数 Worker ルーティング・段階移行計画書（Routing & Deployment Plan）

> 状態: Active / インフラ・デプロイ・ルーティング設計書
> 最終検証: 2026-10-09（`cloudflare/TOPOLOGY.md` の Custom Domain / Route 現況および `OPEN_DECISIONS.md` D-02 に基づき改定）
> 関連ドキュメント: [`README.md`](README.md), [`cloudflare/TOPOLOGY.md`](cloudflare/TOPOLOGY.md), [`UI_MIGRATION_GUIDE.md`](UI_MIGRATION_GUIDE.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-02, D-05)

## 1. 概要

本ドキュメントは、同一ドメイン (`flamenode.net` / `www.flamenode.net`) 配下において、現行の Next.js Worker (`flamenode-web`) を稼働させながら、新 Worker（`flamenode-site`, `flamenode-app`, `flamenode-api`）を段階的に導入・トラフィック切り替えするためのルーティング仕様とデプロイ手順を定義する。

---

## 2. Cloudflare Ingress とルーティングマッピング設計

### 現行のインフラ構成 (`cloudflare/TOPOLOGY.md`)
- `flamenode.net` および `www.flamenode.net` は `flamenode-web` の **Custom Domain** として設定。
- zone の Worker Route は現在 0 件。

### 目標ルーティングマッピング一覧

```text
[HTTP Request: flamenode.net/*]
  │
  ├─ 1. /api/* ─────────────────────────> flamenode-api (Hono API)
  │
  ├─ 2. SPA 静的アセット ───────────────> flamenode-app (Vite SPA Static Assets)
  │      ・ /_app_assets/*
  │
  ├─ 3. 管理・個人・登録画面 ───────────> flamenode-app (Vite SPA Client Entry)
  │      ・ /dashboard/*
  │      ・ /entry/*
  │      ・ /manage/*
  │      ・ /admin/*
  │      ・ /onboarding
  │
  ├─ 4. Astro 静的アセット ─────────────> flamenode-site (Astro Static Assets)
  │      ・ /_astro/*
  │
  ├─ 5. 公開閲覧画面群（段階移行）──────> flamenode-site (Astro SSG)
  │      ・ / (トップ)
  │      ・ /event/*, /groups/*
  │      ・ /user/*
  │      ・ /list, /recommend, /trending
  │      ・ /about, /rules
  │      ・ /:id (動画詳細)
  │
  └─ 6. /* (上記以外の未移行ルート) ─────> flamenode-web (現行 Next.js / OpenNext)
```

### パス・アセット衝突の完全防止
- **Astro 静的アセット**: `/_astro/*`
- **Vite SPA 静的アセット**: `/_app_assets/*`
- **Next.js 静的アセット**: `/_next/*`
プレフィックスが完全に分離されているため、アセットのキャッシュ競合や誤ルーティングは発生しません。

---

## 3. Custom Domain と Worker Route の共存検証（D-02 参照）

同一ホスト名において、Custom Domain（`flamenode-web`）を維持したまま、特定パスパターン（例: `/api/*`）の Worker Route を被せて新 Worker へルーティングできるかは、本番適用前に非本番ドメインで実証が必要です（[`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) D-02）。
不整合が生じる場合は、前段に薄い Ingress Router Worker を配置して Service Bindings で振り分ける方式を代替案とします。

---

## 4. 段階的カットオーバー手順（Staged Cutover）

> **重要**: 本番の Worker Route、Custom Domain、DNS 設定変更は、`AGENTS.md` により**ユーザーの明示承認が必須**です。

1. **Step A: API 導通（Phase 6 完了時）**:
   - `/api/*` のルーティングを `flamenode-api` へ向ける。Next.js 側からも新 API 経由での動作を確認。
2. **Step B: 公開画面の段階切り替え（Phase 5 完了時）**:
   - `/about`, `/rules` → `/event/*` → `/user/*` → `/list` → `/` → `/:id` の順に段階的に `flamenode-site` へ向ける。
3. **Step C: 管理画面の切り替え（Phase 7 完了時）**:
   - `/dashboard/*`, `/entry/*`, `/manage/*`, `/admin/*`, `/onboarding` を `flamenode-app` へ向ける。
4. **Step D: 完全移行と旧 Worker 停止（Phase 9）**:
   - 全トラフィックが新構成へ移行完了し、`flamenode-web` のリクエストが 0 であることを確認後、旧 Worker を退役。

---

## 5. ロールバック手順（Emergency Rollback）

不具合発生時は、以下の手段で即座に旧環境へ復旧します：
1. **Worker Route の解除**:
   Cloudflare Dashboard または Cloudflare API より、対象パスの Worker Route を無効化／削除することで、直ちに Custom Domain 宛先（`flamenode-web`）へトラフィックを戻す。
2. **Worker デプロイ自体のロールバック**:
   新 Worker 側で不具合があった場合は、`npx wrangler rollback [deployment-id]` を実行して直前の安定バージョンへロールバック。
