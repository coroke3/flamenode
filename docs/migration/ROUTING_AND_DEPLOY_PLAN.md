# FlameNode 複数 Worker ルーティング・段階移行計画書（Routing & Deployment Plan）

> 状態: Active / インフラ・デプロイ・ルーティング設計正本
> 関連ドキュメント: [`README.md`](README.md), [`cloudflare/TOPOLOGY.md`](cloudflare/TOPOLOGY.md), [`UI_MIGRATION_GUIDE.md`](UI_MIGRATION_GUIDE.md)

## 1. 概要

本ドキュメントは、同一ドメイン (`flamenode.net` / `www.flamenode.net`) 配下において、現行の Next.js Worker (`flamenode-web`) を稼働させながら、新 Worker（`flamenode-site`, `flamenode-app`, `flamenode-api`）を段階的に導入・トラフィック切り替えするためのルーティング仕様とデプロイ手順を定義する。

---

## 2. Cloudflare Workers Routes 設計と優先順位

Cloudflare では、より具体的なパスパターンが一般的なパターンより優先して評価されます。

### ルーティングマッピング一覧

```text
[HTTP Request: flamenode.net/*]
  │
  ├─ 1. /api/* ─────────────────────────> flamenode-api (Hono API)
  │
  ├─ 2. /dashboard/_app_assets/* ───────> flamenode-app (Vite SPA Static Assets)
  ├─ 3. /dashboard/* ───────────────────> flamenode-app (Vite SPA Client Entry)
  │
  ├─ 4. /_astro/* ──────────────────────> flamenode-site (Astro Static Assets)
  ├─ 5. 公開ルート群（段階移行）─────────> flamenode-site (Astro SSG)
  │      ・ / (トップ)
  │      ・ /event/*, /events/*
  │      ・ /users/*
  │      ・ /:id (動画詳細)
  │
  └─ 6. /* (上記以外の未移行ルート) ─────> flamenode-web (現行 Next.js / OpenNext)
```

### パス衝突の完全防止
- **Astro 静的アセット**: `/_astro/*`
- **Vite SPA 静的アセット**: `/dashboard/_app_assets/*`
- **Next.js 静的アセット**: `/_next/*`
- すべてのアセットプレフィックスが完全に分離されているため、キャッシュの競合や誤ルーティングは構造上発生しません。

---

## 3. 段階的カットオーバー（Staged Cutover）手順

### フェーズ A: API 導通（Phase 6 完了時）
- `flamenode.net/api/*` の Worker Route を `flamenode-api` へ向ける。
- Next.js 側からも新 API をプロキシまたは直接利用可能とし、API の疎通と性能（CPU 時間 < 10ms）を確認。

### フェーズ B: 公開画面の段階切り替え（Phase 5 完了時）
- 特定の公開ルートから順に `flamenode-site` へ向ける：
  1. `/events/*`（イベント一覧・詳細）
  2. `/users/*`（クリエイタープロフィール）
  3. `/`（トップページ）
  4. `/:id`（動画詳細）
- 各ステップで Google Analytics、SEO メタデータ、表示速度を検証。

### フェーズ C: 管理画面の切り替え（Phase 7 完了時）
- `/dashboard/*` の Worker Route を `flamenode-app` へ向ける。
- 認証セッションの維持、動画編集・枠予約の正常系を検証。

### フェーズ D: 完全移行と旧 Worker 停止（Phase 9）
- 全ルートが新構成（Astro + Vite + Hono）へ移行完了したことを確認。
- `flamenode-web`（Next.js / OpenNext）の Worker Route を解除し、退役（Retirement）させる。

---

## 4. ロールバック手順（Emergency Rollback）

不具合発生時は、Cloudflare Dashboard または Wrangler CLI より該当ルートの宛先を即座に `flamenode-web`（現行 Next.js）へ戻すことで、**数秒以内の無停止ロールバック**が可能です。
```bash
# 緊急ロールバック例: 公開ルートを現行Nextへ戻す
npx wrangler routes set "flamenode.net/*" --script "flamenode-web"
```
