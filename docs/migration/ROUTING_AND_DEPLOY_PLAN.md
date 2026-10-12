# FlameNode 複数 Worker ルーティング・段階移行計画書（Routing & Deployment Plan）

> 状態: Active / インフラ・デプロイ・ルーティング設計書
> 最終検証: 2026-10-09（`cloudflare/TOPOLOGY.md` の Custom Domain / Route 現況および `OPEN_DECISIONS.md` D-02 に基づき改定）
> 関連ドキュメント: [`README.md`](README.md), [`cloudflare/TOPOLOGY.md`](cloudflare/TOPOLOGY.md), [`UI_MIGRATION_GUIDE.md`](UI_MIGRATION_GUIDE.md), [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) (D-02, D-05)

## 1. 概要

本ドキュメントは、同一ドメイン (`flamenode.net` / `www.flamenode.net`) 配下において、現行の Next.js Worker (`flamenode-web`) を稼働させながら、新 Worker（`flamenode-site`, `flamenode-personal`, `flamenode-ops`, `flamenode-api`）を段階的に導入・トラフィック切り替えするためのルーティング仕様とデプロイ手順を定義する。

---

## 2. Cloudflare Ingress とルーティングマッピング設計

### 現行のインフラ構成 (`cloudflare/TOPOLOGY.md`)
- `flamenode.net` および `www.flamenode.net` は `flamenode-web` の **Custom Domain** として設定。
- zone の Worker Route は現在 0 件。

### 目標ルーティングマッピング一覧

```text
[HTTP Request: flamenode.net/*]
  │
  ├─ 1. /api/auth/* ───────────────────> flamenode-web (Auth.js; Phase 8まで維持)
  │      ・ Phase 8 の認証切替承認・検証完了後のみ新認証へ
  ├─ 1b. /api/<移行済みの明示パス> ──> flamenode-api (Hono)
  │      ・ 未移行の /api/* は flamenode-web へフォールバック
  │
  ├─ 2. Personal SPA アセット ────────> flamenode-personal (apps/app)
  │      ・ /_personal_assets/*
  ├─ 3. Ops SPA アセット ─────────────> flamenode-ops (apps/ops; Phase7で新設)
  │      ・ /_ops_assets/*
  ├─ 3a. Personal SPA画面 ────────────> flamenode-personal
  │      ・ /dashboard, /dashboard/*, /entry, /entry/*, /onboarding
  ├─ 3b. Ops SPA画面 ─────────────────> flamenode-ops
  │      ・ /manage, /manage/*, /admin, /admin/*
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
- **Vite Personal SPA 静的アセット**: `/_personal_assets/*`
- **Vite Ops SPA 静的アセット**: `/_ops_assets/*`
- **Next.js 静的アセット**: `/_next/*`
アセットのURLプレフィックスは分離する。ただし実配信時の優先順位・Cache-Control・SPAのdirect reload・旧Workerへのフォールバックは統合テストで検証する。プレフィックス分離だけで競合や誤ルーティングが無いとは断定しない。

---

## 3. Custom Domain と Worker Route の共存検証（D-02 参照）

Cloudflare公式文書では同一hostnameのRouteがCustom Domainより優先され、Route側の`fetch(request)`はCustom DomainのWorkerへ到達する。採用方式D-02はA。ただし特定パスパターン・root/www・静的アセット・認証フォールバックがこのrepoで正しく動くか、本番適用前に非本番ドメインで実証が必要です（[`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) D-02）。
不整合時は原因と失敗例を記録し、本番切替を止める。B案への自動切替は禁止。追加Routeは実際のCloudflare globルールに従い `/ :id` のようなNext形式をそのまま登録しない。

---

## 4. 段階的カットオーバー手順（Staged Cutover）

非本番Gateway/Route-map/CPU実証（MIG-0401→0404→0405→0406）はユーザーHTMLモック非依存。ただし**本番画面切替**はMIG-0403のapproved visual/UX + MIG-0406性能証跡からなるMIG-0407 Gate、および個別path単位の本番操作承認後だけ行う。測定と停止条件は[PERFORMANCE_IMPLEMENTATION_PLAN.md](PERFORMANCE_IMPLEMENTATION_PLAN.md)。

> **重要**: 本番の Worker Route、Custom Domain、DNS 設定変更は、`AGENTS.md` により**ユーザーの明示承認が必須**です。

1. **Step A: 個別API導通（Phase 6 の各API契約検証後）**:
   - `route-handlers/README.md` の RH ID とHTTP method単位で、**検証済みの個別パスだけ** `flamenode-api` へ送る。`/api/*` 一括切替は禁止。
   - `/api/auth/*`、未移行API、Next専用Server Actionは旧 `flamenode-web` に残す。旧Next.jsと新SPA双方の認証Cookie・CSRF・同一origin・権限・レスポンス契約をE2E確認する。
   - Phase 8の専用cutoverまで `/api/auth/*` をHono側の汎用ルートで捕捉しない。Worker RouteはHTTP method別には振り分けられないため、同一パスの一部methodだけ移す場合はrouter側の分岐またはパス全体の同時互換完了が必要。
2. **Step B: 公開画面の段階切り替え（Phase 5 完了・依存するAPI疎通後）**:
   - **低リスク・性能寄与の順**: `/about`, `/rules`（最初の安全確認）→ `/user/*` → `/list`, `/recommend`, `/trending` → `/event/*`, `/groups/*` → `/` → root動画 `/:id`（最後）。root slugのCloudflare globと固定path衝突・古いaliasや/redirectは明示的dispatchを実際の非本番Workerで検証する。`MIG-0504`/`0505`は`0501`DONEから始められるが、イベントMIGのUX要件や他のtask Gateを飛ばさない。
3. **Step C: 管理画面の切り替え（Phase 7 完了・依存するHono API疎通後）**:
   - Personal `/dashboard/*`, `/entry/*`, `/onboarding` を `flamenode-personal`へ、Ops `/manage/*`, `/admin/*` を `flamenode-ops`へ**別々**に切替。bare pathとdeep-linkも対象。受入テストと責任者はそれぞれ独立。
4. **Step D: 認証の専用切替（Phase 8 Gate 後、要承認）**:
   - `/api/auth/*` と `/auth/complete` の処理先を、既存セッション継続・Callback・logout・CSRFのテスト後に切り替える。
5. **Step E: 完全移行と旧 Worker 停止（Phase 9）**:
   - 全トラフィックが新構成へ移行完了し、`flamenode-web` のリクエストが 0 であることを確認後、旧 Worker を退役。

---

## 5. ロールバック手順（Emergency Rollback）

不具合発生時は、以下の手段で即座に旧環境へ復旧します：
1. **Worker Route の解除**:
   Cloudflare Dashboard または Cloudflare API より、対象パスの Worker Route を無効化／削除することで、直ちに Custom Domain 宛先（`flamenode-web`）へトラフィックを戻す。
2. **Worker デプロイ自体のロールバック**:
   対象Workerのデプロイ一覧から正常版のversion IDとbinding compatibilityを確認し、**その時点の公式Wrangler/Cloudflare Dashboardで有効な手順**で復旧する。実行コマンドと検証結果はcutover PRへ記録する。プレースホルダーのCLIコマンドを本番で実行しない。
3. **データ・セッション整合性**:
   Routerを戻してもD1・Queue・認証・cacheは戻らない。旧ランタイムが新データを読めるexpand/contract互換を検証し、書き込み切替後の差分をreconcileするまで単純rollback完了と扱わない。

## 6. Cutover acceptance（必須）

- D-02の非本番PoC: Worker Routeと既存Custom Domainの優先順および`fetch(request)`フォールバックをroot/www相当ホストで証明。ルート同居の本番適用は別途ユーザー承認。
- D-05の2SPA: Personal/Opsに独立したStatic Assetsとアセットmanifest、prefix、deep-link、login/forbidden、cross-SPAリンクを検証。両方が未完成の間は旧Nextへフォールバック。
- D-06の大量公開ページはSSG/R2事前HTMLを優先し、Workerに高コストなオンデマンドSSRを流さない。限定SSRはCPU/1102事前計測合格時のみ。


- D-02の非本番 ingress PoC合格と、root/www両hostのrouter/fallback契約確認
- 対象パスのcanonical URL・query・cookie・認可・`/_personal_assets/*`、`/_ops_assets/*`・`/_astro/*`・`/_next/*` の直アクセス/更新確認
- 本番切替前後で現行 `RH-*` / `SA-*` と `UX-*` / `FN-*` に紐づく必要E2Eを実施
- 復帰の順序（traffic、feature flag、cache、D1 reconciliation）、責任者、測定閾値、観測期間をcutover PRに記録
- `ROUTING_AND_DEPLOY_PLAN.md` は案であり、本番Routeを変更する許可ではない

