# デプロイ準備チェックリスト

> Status: Active
> Last verified: 2026-08-02
> Verified against commit: `901fa0aa`（[`DEPLOY.md`](../../DEPLOY.md) §3・§4、`scripts/cloudflare-production.mjs` と整合）
> Source of truth: [`DEPLOY.md`](../../DEPLOY.md)、[`workers.md`](workers.md)、[`LOCAL.md`](../../LOCAL.md)、[`migrations.md`](migrations.md)、[`.dev.vars.example`](../../.dev.vars.example)、`wrangler.toml`、`workers/*/wrangler.toml`、`package.json` の `cf:*`、`scripts/cloudflare-*.mjs`

運用者が Cloudflare へデプロイする一歩手前までを追えるチェックリスト。詳細手順・障害対応・rollback は [`DEPLOY.md`](../../DEPLOY.md) を正本とし、本書は横断確認用にとどめる。secret の実値、production resource ID、token は本書・Issue・log へ書かない。

## 使い方

- [ ] 各章を上から順に確認し、未完了項目を Dashboard / ローカルで解消する。
- [ ] 初回は **workers.dev で smoke 成功後** にカスタムドメインと Discord を更新する（§9）。
- [ ] Remote D1 migration は本チェックリストの対象外とし、別途 [`migrations.md`](migrations.md) に従い手動適用する（§10）。

---

## 1. 全体像

| 領域 | 名前 / 役割 |
| --- | --- |
| Web Worker | `flamenode-web`（OpenNext + Workers Static Assets、`run_worker_first = false`） |
| Cron Worker | `flamenode-fast-jobs`（通知・リマインダー、Recovery Cron 毎時0分） |
| Cron Worker | `flamenode-content-jobs`（静的JSON再生成、Recovery Cron 毎時15分） |
| Cron Worker | `flamenode-sync-jobs`（YouTube同期、Recovery Cron 毎時7分・52分） |
| Database | Cloudflare D1 `flamenode_db` |
| Object storage | Cloudflare R2 `flamenode-storage` |
| Cache / 軽量状態 | Cloudflare KV（bootstrap 表示名 `FLAMENODE_KV`） |
| CI/CD | `flamenode-web` に接続した **Workers Builds 1件のみ** |

production の固定 deploy 順（1 push = 1 Build）:

```text
main push
  -> npm ci（1回）
  -> verify:cloud（deploy契約検査のみ）
  -> OpenNext build（1回）
  -> flamenode-content-jobs
  -> flamenode-fast-jobs
  -> flamenode-sync-jobs
  -> flamenode-web
  -> production smoke
```

- [ ] Git 連携は `flamenode-web` だけ。Cron Worker 3本へ個別 Git 連携を付けない。
- [ ] GitHub Actions の push / PR / schedule による自動 deploy がない。
- [ ] 旧 Cloudflare Pages Git Integration を停止し、Workers Builds と二重起動しない。

詳細: [`DEPLOY.md` §1–2](../../DEPLOY.md)、[`workers.md`](workers.md)

---

## 2. Discord OAuth

| 項目 | 確認内容 |
| --- | --- |
| `AUTH_URL` | Web の正式 HTTPS origin と一致（`NEXT_PUBLIC_SITE_URL` / `FLAMENODE_WEB_URL` と同じ） |
| `AUTH_DISCORD_ID` | Discord Developer Portal の Client ID。**Build Variables 必須**（deploy 時に web の generated config へ注入。web Runtime にも同名が必要） |
| `AUTH_DISCORD_SECRET` | Runtime Secret のみ（Build へ複製しない） |
| Callback URL | `https://<正式origin>/api/auth/callback/discord` |
| `AUTH_TRUST_HOST` | **ローカル開発時のみ** `.dev.vars` で `true`。production では Host header fallback / `trustHost` 無効化で origin 不一致を回避しない |

チェックリスト:

- [ ] Discord Developer Portal に上記 callback を登録した（初回は workers.dev origin、カスタムドメイン切替後に更新）。
- [ ] `AUTH_URL`・`NEXT_PUBLIC_SITE_URL`・`FLAMENODE_WEB_URL`・Discord redirect の scheme / host / port が完全一致。
- [ ] production で `AUTH_TRUST_HOST=true` を Dashboard に置いていない。

ローカル例: [`LOCAL.md` §3・§5](../../LOCAL.md)、[`.dev.vars.example`](../../.dev.vars.example)

---

## 3. D1 / R2 / KV の作成と binding

### resource 作成

初回のみ、運用者が明示した場合:

```sh
npm ci --no-audit --no-fund
npm run cf:bootstrap -- --confirm-create
```

`cf:bootstrap` は D1・R2・KV の作成のみ。migration・Worker deploy・secret 更新は行わない。作成後は Dashboard で実 ID を確認し、**Build Variables へ直接登録**する（repo へ実 ID を書かない）。

`cf:bootstrap` が作成する名前（変更しない）:

| 種類 | 名前 |
| --- | --- |
| D1 | `flamenode_db` |
| R2 | `flamenode-storage`（`CF_R2_BUCKET_NAME` と一致必須） |
| KV | 表示名 `FLAMENODE_KV`（Build Variable には Dashboard の namespace **ID** を `CF_KV_NAMESPACE_ID` へ登録） |

- [ ] D1 `flamenode_db` 作成済み
- [ ] R2 `flamenode-storage` 作成済み
- [ ] KV `FLAMENODE_KV` 作成済み
- [ ] 実 ID / bucket 名を Build Variables（§6）へ登録済み

### binding 論理名（全 Worker で一致させる）

| Worker | D1 | R2 | KV | Queue | その他 |
| --- | --- | --- | --- | --- | --- |
| `flamenode-web` | `DB` | `BUCKET`、`NEXT_INC_CACHE_R2_BUCKET` | `KV` | producer: `NOTIFICATION_WAKE_QUEUE`、`STATIC_REBUILD_WAKE_QUEUE`、`YOUTUBE_SYNC_WAKE_QUEUE` | Assets `ASSETS`、service `WORKER_SELF_REFERENCE` |
| `flamenode-fast-jobs` | `DB` | — | `KV` | producer/consumer: `NOTIFICATION_WAKE_QUEUE` | — |
| `flamenode-content-jobs` | `DB` | `R2` | `KV` | producer/consumer: `STATIC_REBUILD_WAKE_QUEUE` | — |
| `flamenode-sync-jobs` | `DB` | `R2` | `KV` | producer/consumer: `YOUTUBE_SYNC_WAKE_QUEUE` | — |

**注意:** 追跡対象の `wrangler.toml` / `workers/*/wrangler.toml` は placeholder ID のまま維持する。production の実 ID は Build 時に `.cloudflare/generated/` へ注入され、Git 管理外とする。

- [ ] Dashboard の各 Worker binding が上表の論理名と一致
- [ ] Queue binding 欠落時は deploy 検査が fail-closed することを理解済み
- [ ] repo の wrangler template に production 実 ID をコミットしていない

詳細: [`DEPLOY.md` §4 Bindings](../../DEPLOY.md)、[`workers.md`](workers.md)、[`LOCAL.md` §9](../../LOCAL.md)

---

## 4a. Cloudflare Queues（wake 6本）

通常運用は Queue 駆動を優先し、Cron は Recovery 用の安全網とする。業務データは載せない（D1 が処理正本）。詳細は [`workers.md`](workers.md)。

### Queue リソース作成（初回のみ）

```sh
npx wrangler queues create flamenode-notification-wake
npx wrangler queues create flamenode-notification-dlq
npx wrangler queues create flamenode-static-rebuild-wake
npx wrangler queues create flamenode-static-rebuild-dlq
npx wrangler queues create flamenode-youtube-sync-wake
npx wrangler queues create flamenode-youtube-sync-dlq
```

### producer / consumer / DLQ チェックリスト

| Queue | binding | producer | consumer | DLQ |
| --- | --- | --- | --- | --- |
| `flamenode-notification-wake` | `NOTIFICATION_WAKE_QUEUE` | `flamenode-web`、`flamenode-fast-jobs` | `flamenode-fast-jobs` | `flamenode-notification-dlq` |
| `flamenode-static-rebuild-wake` | `STATIC_REBUILD_WAKE_QUEUE` | `flamenode-web`、`flamenode-content-jobs` | `flamenode-content-jobs` | `flamenode-static-rebuild-dlq` |
| `flamenode-youtube-sync-wake` | `YOUTUBE_SYNC_WAKE_QUEUE` | `flamenode-web`、`flamenode-sync-jobs` | `flamenode-sync-jobs` | `flamenode-youtube-sync-dlq` |

- [ ] wake Queue 3本 + DLQ 3本を作成済み
- [ ] `flamenode-web` は 3 Queue すべてへ **producer のみ**（consumer なし）
- [ ] 各 Cron Worker は対応 Queue の **consumer** と継続 wake 用 **producer** を持つ
- [ ] consumer の `dead_letter_queue` が上表 DLQ と一致
- [ ] `npm run check:cloudflare-template` が Queue binding 欠落を検出する（fail-closed）

### Queue feature flags（Phase 1 デフォルト無効）

全 Worker（`flamenode-web` 含む）で wrangler template どおり **`"0"`** で開始し、段階的に有効化する。ロールバックは該当 flag を `"0"` へ戻すだけでよい。

| 変数名 | 意味 |
| --- | --- |
| `QUEUE_DISPATCH_ENABLED` | Web 等からの wake 送信 |
| `QUEUE_CONTINUATION_ENABLED` | Consumer invocation からの継続 wake |
| `QUEUE_YOUTUBE_SYNC_ENABLED` | YouTube sync wake の有効化 |

- [ ] 初回 deploy 時、上記 3 flag が全 Worker で `"0"` である
- [ ] 有効化は `"1"` / `"true"` / `"yes"` を Dashboard または Runtime Variables で設定
- [ ] 正本: `src/lib/queues/wakeBudget.ts` の `QUEUE_FEATURE_FLAG_NAMES`

---

## 4. Workers Builds 設定

対象 Worker: **`flamenode-web` のみ**

| 設定 | 値 |
| --- | --- |
| Repository | `coroke3/flamenode` |
| Production branch | `main` |
| Preview / PR builds | **無効** |
| Root directory | 空欄（repository root） |
| Build Variable `NODE_VERSION` | `22` |
| Build Variable `SKIP_DEPENDENCY_INSTALL` | `true` |
| Build command | `npm ci --no-audit --no-fund && npm run cf:cloud-build` |
| Deploy command | `npm run cf:deploy-production && npm run cf:smoke-production` |

Variables / Secrets の分離:

- [ ] **Build Variables** … 非機密の build / deploy 検査用（§6 一覧）
- [ ] **Build Secrets** … `CLOUDFLARE_API_TOKEN`、`WORKER_ADMIN_TOKEN` のみ
- [ ] **Runtime Variables** … 各 Worker の公開 metadata・origin・`BUILD_COMMIT_SHA`（§7）。production origin / OAuth Client ID / commit は Build Variables から generated config へ注入し、Dashboard で同名を別正本として drift させない
- [ ] **Runtime Secrets** … 各 Worker の機密名（§7）。通常の Runtime Secret を Build へ複製しない
- [ ] 例外: `WORKER_ADMIN_TOKEN` は deep-health smoke 用に Build Secret と `flamenode-web` / `flamenode-content-jobs` の Runtime Secret の両方へ登録

`CLOUDFLARE_API_TOKEN` は 4 Worker deploy、remote secret 名の一覧取得、Remote D1 の read-only 検査に必要な**最小権限**だけを与える。権限不足は迂回せず Build 失敗とする。

### Workers Builds 自動提供（Dashboard 手動登録不要）

`CI`、`WORKERS_CI`、`WORKERS_CI_BRANCH`、`WORKERS_CI_BUILD_UUID`、`WORKERS_CI_COMMIT_SHA` は Workers Builds が提供する。`WORKERS_CI_COMMIT_SHA` は 40 桁 SHA・git HEAD と一致必須で、欠落・不正・`unknown`・手動上書きでは deploy を停止する。

詳細: [`DEPLOY.md` §2–3](../../DEPLOY.md)

---

## 5. Cron Trigger（Recovery 4式）

確認箇所: 各 Worker の `workers/*/wrangler.toml` の `[triggers]`、および Cloudflare Dashboard の Cron 設定。通常運用は Queue 駆動を優先し、Cron は wake が届かなかった場合の安全網とする。

| Worker | Cron 式 | 役割（概要） |
| --- | --- | --- |
| `flamenode-fast-jobs` | `0 * * * *` | 通知・締切リマインダー（Recovery） |
| `flamenode-content-jobs` | `15 * * * *` | 静的 JSON 再生成（Recovery） |
| `flamenode-sync-jobs` | `7 * * * *`、`52 * * * *` | YouTube metadata / playlist 同期（Recovery） |

- [ ] 上記 4 式のみ存在（追加・変更なし）
- [ ] Cron Worker へ Git 連携を付けていない
- [ ] Dashboard の Cron 式が wrangler template と一致
- [ ] Cloudflare アカウントの Cron Trigger 合計が上限 5 件以内（リポジトリ外の既存 Trigger は削除しない）

詳細: [`workers.md`](workers.md)、[`DEPLOY.md` §4 Cron Triggers](../../DEPLOY.md)

---

## 6. Build Variables（名前のみ）

Dashboard の Build Variables に次の**名前**が揃っていること。値は Dashboard / 安全な operator 環境でのみ管理する。

| 変数名 | 用途 |
| --- | --- |
| `NODE_VERSION` | Node.js 22 |
| `SKIP_DEPENDENCY_INSTALL` | `npm ci` を Build command で1回に固定 |
| `CLOUDFLARE_ACCOUNT_ID` | production account ID |
| `CF_D1_DATABASE_ID` | production D1 UUID |
| `CF_KV_NAMESPACE_ID` | production KV namespace ID |
| `CF_R2_BUCKET_NAME` | production R2 bucket name（既定 `flamenode-storage`） |
| `FLAMENODE_WEB_URL` | Web の HTTPS origin |
| `FAST_JOBS_URL` | fast-jobs の HTTPS origin |
| `CONTENT_JOBS_URL` | content-jobs の HTTPS origin |
| `SYNC_JOBS_URL` | sync-jobs の HTTPS origin |
| `NEXT_PUBLIC_SITE_URL` | `FLAMENODE_WEB_URL` と同じ origin |
| `AUTH_URL` | `FLAMENODE_WEB_URL` と同じ origin |
| `AUTH_DISCORD_ID` | production Discord OAuth Client ID（**必須**。未設定だと deploy preflight 失敗） |
| `QUEUE_DISPATCH_ENABLED` | 任意。Queue wake 有効時は `"1"`（未設定時は template `"0"`） |
| `QUEUE_CONTINUATION_ENABLED` | 任意。継続 wake 有効時は `"1"` |
| `QUEUE_YOUTUBE_SYNC_ENABLED` | 任意。YouTube sync wake 有効時は `"1"` |
| `GA4_SYNC_ENABLED` | 任意。急上昇同期を有効化するとき `"1"`（`1` なら sync-jobs の GA4 Runtime Secrets が必須） |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | 任意。OpenNext bake-in + web inject 用の `G-...` |
| `PUBLIC_VISIBILITY_GUARD_MODE` | 任意。`observe`（既定）/ `enforce` / `off` |
| `FLAMENODE_ALLOW_WORKERS_DEV_ORIGIN` | 初回 `workers.dev` smoke だけ `"1"`。custom domain 切替後は **未設定** |

URL 制約（初回 `workers.dev` 登録時に失敗しやすい）:

- 各 URL は `https://host` 形式のみ（末尾 `/` のみ可。path / query / hash / `localhost` 不可）。
- `FLAMENODE_WEB_URL`・`FAST_JOBS_URL`・`CONTENT_JOBS_URL`・`SYNC_JOBS_URL` は**相互に重複不可**。
- `NEXT_PUBLIC_SITE_URL` と `AUTH_URL` は `FLAMENODE_WEB_URL` と同一 origin。
- custom domain 切替後は `FLAMENODE_WEB_URL`・`NEXT_PUBLIC_SITE_URL`・`AUTH_URL` をカスタム HTTPS origin へ揃え、`workers.dev` のまま放置しない（[`DEPLOY.md` §3](../../DEPLOY.md) と同趣旨）。

Build Secrets（名前のみ）:

- `CLOUDFLARE_API_TOKEN`（最小権限。不足時は Build 失敗）
- `WORKER_ADMIN_TOKEN`（deep-health smoke 用。web / content-jobs Runtime にも同値を登録）

自動提供（上書き禁止）:

- `WORKERS_CI_COMMIT_SHA`

---

## 7. Runtime Variables / Secrets（名前のみ）

### Runtime Variables

| Worker | 変数名 |
| --- | --- |
| `flamenode-web` | `NEXT_PUBLIC_SITE_URL`、`AUTH_URL`、`AUTH_DISCORD_ID`、公開 site metadata、`BUILD_COMMIT_SHA`、`QUEUE_DISPATCH_ENABLED`、`QUEUE_CONTINUATION_ENABLED`、`QUEUE_YOUTUBE_SYNC_ENABLED`、`PUBLIC_VISIBILITY_GUARD_MODE`（任意・未設定時 template `observe`） |
| `flamenode-fast-jobs` | `BUILD_COMMIT_SHA`、`QUEUE_DISPATCH_ENABLED`、`QUEUE_CONTINUATION_ENABLED`、`QUEUE_YOUTUBE_SYNC_ENABLED`（`NEXT_PUBLIC_SITE_URL` は Build Variables から deploy 時に generated config へ注入） |
| `flamenode-content-jobs` | `BUILD_COMMIT_SHA`、`QUEUE_DISPATCH_ENABLED`、`QUEUE_CONTINUATION_ENABLED`、`QUEUE_YOUTUBE_SYNC_ENABLED` |
| `flamenode-sync-jobs` | `YOUTUBE_DAILY_QUOTA_LIMIT`、`BUILD_COMMIT_SHA`、`QUEUE_DISPATCH_ENABLED`、`QUEUE_CONTINUATION_ENABLED`、`QUEUE_YOUTUBE_SYNC_ENABLED`（`GA4_SYNC_ENABLED` は Build Variables から生成 config へ inject） |

公開 site metadata と YouTube quota の既定値は wrangler template を正本とする。production origin / OAuth Client ID / commit は検証済み一時 config へ注入し、Dashboard で同名値を別正本として手動 drift させない。

旧環境から移行する場合: 廃止済みの `YOUTUBE_API_KEY_SECONDARY` など旧 secret が残っていれば削除する（詳細は [`workers.md`](workers.md)）。

### Runtime Secrets

| Worker | secret 名 |
| --- | --- |
| `flamenode-web` | `AUTH_SECRET`、`AUTH_DISCORD_SECRET`、`SPREADSHEET_IMPORT_PREVIEW_SECRET`、`WORKER_ADMIN_TOKEN` |
| `flamenode-fast-jobs` | `DISCORD_BOT_TOKEN` または `DISCORD_WEBHOOK_URL` の少なくとも一方 |
| `flamenode-content-jobs` | `WORKER_ADMIN_TOKEN` |
| `flamenode-sync-jobs` | `YOUTUBE_API_KEY`、`YOUTUBE_OAUTH_CLIENT_ID`、`YOUTUBE_OAUTH_CLIENT_SECRET`、`YOUTUBE_OAUTH_REFRESH_TOKEN` |
| `flamenode-sync-jobs`（条件付き） | `GA4_PROPERTY_ID`、`GA4_SERVICE_ACCOUNT_EMAIL`、`GA4_SERVICE_ACCOUNT_PRIVATE_KEY`（`GA4_SYNC_ENABLED=1` 時必須。詳細は [`google-analytics.md`](google-analytics.md)） |

- [ ] 各 Worker に上記が Dashboard で登録済み（deploy preflight は**名前のみ**検査）
- [ ] secret 値を Build Variables へ複製していない（`WORKER_ADMIN_TOKEN` の smoke 例外を除く）

ローカル開発で使う追加項目（本番 Dashboard とは別管理）: [`.dev.vars.example`](../../.dev.vars.example)

詳細: [`DEPLOY.md` §4](../../DEPLOY.md)

---

## 8. ローカルでデプロイ直前まで確認するコマンド

依存関係インストール後、ローカルでは`verify:fast`、Workers Builds と同じ経路を確認するなら`verify:cloud`と OpenNext build を通す。

```sh
npm ci --no-audit --no-fund
npm run verify:fast
# Workers Builds と同経路だけ確認する場合:
# npm run verify:cloud
```

OpenNext 成果物（commit SHA 埋め込み必須）:

Windows PowerShell:

```powershell
$env:WORKERS_CI_COMMIT_SHA = (git rev-parse HEAD).Trim()
npm run cf:build
Remove-Item Env:WORKERS_CI_COMMIT_SHA
```

macOS / Linux:

```sh
export WORKERS_CI_COMMIT_SHA="$(git rev-parse HEAD)"
npm run cf:build
unset WORKERS_CI_COMMIT_SHA
```

任意の追加構造確認（実 production URL / ID を要求しない）:

```sh
npm run check:open-next-output
npm run check:cloudflare-template
npm run test:cloudflare-ci
```

- [ ] `verify:fast` 成功
- [ ] `WORKERS_CI_COMMIT_SHA` 付き `cf:build` 成功
- [ ] `check:cloudflare-config` をローカルで無理に通そうとしていない（実 ID 未設定時の fail-closed は正常）

詳細: [`LOCAL.md` §6–7](../../LOCAL.md)、[`DEPLOY.md` §7](../../DEPLOY.md)

---

## 9. 本番初回の順序

1. [ ] §1–7 の Dashboard 準備完了（4 Worker 名、resource、Queue、binding、Runtime Secret、D1 schema）
2. [ ] Remote D1 へ active migration を**手動適用**済み（§10）。CI / deploy script は自動適用しない
3. [ ] 4 Worker の `workers.dev` URL を Build Variables（`FLAMENODE_WEB_URL` 等）へ登録（§6 の URL 制約を満たす）
4. [ ] 初回 `workers.dev` smoke 用に Build Variables へ `FLAMENODE_ALLOW_WORKERS_DEV_ORIGIN=1` を設定（custom domain 切替後は削除し未設定のままにする）
5. [ ] `flamenode-web` だけ Git 連携し、§4 の Build / Deploy command を保存
6. [ ] `main` へ push し、Workers Build を実行
7. [ ] deploy 固定順（content → fast → sync → web）が完了し、production smoke が次をすべて成功
    - 正式トップと同一 origin の `_next/static` asset
    - 公開 `/api/health` の service / runtime / commit
    - Discord Auth callback が 404 / 5xx ではない
    - Cron Worker 3本の `/health` と commit 一致
    - content-jobs 副作用 endpoint（`/rebuild`・`/process-queue`）の未認証拒否
    - 保護 `/api/health/deep`（`WORKER_ADMIN_TOKEN`）の D1 / KV / R2 / schema read-only 結果
    - 主要公開 API（例: `/api/videos?limit=1`）の明示 DTO と内部 key 非露出
    - 404 と不正 method
8. [ ] **workers.dev** で 4 Worker・Auth callback・health を確認
9. [ ] `flamenode-web` にカスタムドメインを追加
10. [ ] `FLAMENODE_WEB_URL`・`NEXT_PUBLIC_SITE_URL`・`AUTH_URL` をカスタム origin へ更新し、`FLAMENODE_ALLOW_WORKERS_DEV_ORIGIN` を削除（未設定）
11. [ ] Discord callback を `https://<custom-domain>/api/auth/callback/discord` へ更新
12. [ ] 更新後の Workers Build を再実行し、カスタムドメインで smoke 成功
13. [ ] 旧 Pages からトラフィックを切り替え。**削除は [`DEPLOY.md` §9](../../DEPLOY.md) の全条件を満たすまで行わない**
    - custom domain が `flamenode-web` を向く
    - Web / Auth / 3 Cron / deep health / 公開 DTO の production smoke 成功
    - 4 Worker の commit が一致
    - Metrics で継続的な 5xx / `exceededCpu` / binding error がない
    - Discord OAuth と Secure Cookie を実ブラウザで確認
    - rollback 先の正常 commit と D1 backup を記録
    - 観測期間を運用者が承認

---

## 10. Remote D1 migration（手動のみ）

- [ ] backup・対象 SQL・change log・rollback 方針をレビュー済み
- [ ] production deploy / Workers Build / runtime が migration を自動適用しないことを理解済み
- [ ] deploy 前 read-only preflight（schema version・必須 table・`d1_migrations`）が通る状態

手動適用前の環境確認（operator shell。production 値は安全な環境のみ。実 ID / token をコマンド行・history・Issue へ貼らない）:

Windows PowerShell:

```powershell
$env:WORKERS_CI_COMMIT_SHA = (git rev-parse HEAD).Trim()
node scripts/cloudflare-verify-environment.mjs
```

macOS / Linux:

```sh
export WORKERS_CI_COMMIT_SHA="$(git rev-parse HEAD)"
node scripts/cloudflare-verify-environment.mjs
```

手動適用の正本手順: [`migrations.md`](migrations.md)、[`DEPLOY.md` §6](../../DEPLOY.md)

不一致時は Web を含む全 deploy を開始しない。適用後は停止した Build を再試行し、read-only preflight からやり直す。

---

## 11. やってはいけないこと

| 禁止事項 | 理由 |
| --- | --- |
| Cloudflare Pages と Workers Builds の二重 Git 連携 | 同一 push から重複 build / deploy |
| Cron Worker への個別 Git 連携 | deploy 順・commit SHA の不整合 |
| deploy 途中失敗後に手動で後続 Worker だけ deploy | 4 Worker 間の commit / binding / secret 不一致。rollback して同一 commit へ戻す |
| production 実 ID・secret 値を repo へコミット | placeholder template の契約破壊・漏洩 |
| Remote D1 migration の自動適用を CI / deploy へ組み込む | 本番 schema の意図しない変更 |
| `AUTH_TRUST_HOST` で production の origin 不一致を握りつぶす | OAuth・Cookie の不整合 |
| `WORKERS_CI_COMMIT_SHA` の手動上書きや `unknown` での継続 | 追跡不能な deploy |
| Build 失敗を skip する初回専用フラグの使用 | secret / D1 preflight の fail-closed 回避 |

障害時の確認順: [`DEPLOY.md` §11](../../DEPLOY.md)、[`incident-response.md`](incident-response.md)

rollback 正本: [`DEPLOY.md` §10](../../DEPLOY.md)（4 Worker を同じ既知の正常 commit へ戻し、再度 smoke）

---

## 関連文書

| 文書 | 内容 |
| --- | --- |
| [`DEPLOY.md`](../../DEPLOY.md) | production deploy 正本・smoke・rollback |
| [`workers.md`](workers.md) | Cron 上限・quota・監視 |
| [`LOCAL.md`](../../LOCAL.md) | ローカル再現・検査一覧 |
| [`migrations.md`](migrations.md) | D1 migration 手動運用 |
| [`incident-response.md`](incident-response.md) | 障害一次対応 |
