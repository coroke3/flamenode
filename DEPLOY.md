# FlameNode デプロイ手順書

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `e772cc9`
> Source of truth: `package.json`, `wrangler.toml`, `workers/*/wrangler.toml`, `docs/operations/migrations.md`

## Current Worker Layout

Cron Workers are consolidated into 3 deployments:

| Worker | Cron | Config |
| --- | --- | --- |
| `flamenode-fast-jobs` | `*/5 * * * *` | `workers/fast-jobs/wrangler.toml` |
| `flamenode-content-jobs` | `*/15 * * * *` | `workers/content-jobs/wrangler.toml` |
| `flamenode-sync-jobs` | `0 */12 * * *` | `workers/sync-jobs/wrangler.toml` |

Legacy standalone worker directories are import modules only. Do not deploy them directly.

このドキュメントは、FlameNode を Cloudflare の無料枠を中心に本番運用へ載せるために、**あなた自身が手元で実行する必要のある操作**を時系列でまとめたものです。
コードや設計図はすべてリポジトリに揃っています。ここに書かれているのは、**Cloudflare アカウント側 / Discord Developer Portal 側 / シェル上で行う 1 回〜数回の操作**だけです。

> **前提**: Cloudflare アカウント、Discord アプリ、独自ドメイン (任意) が用意できる Windows / macOS / Linux 環境。
>
> 推奨ターミナル: PowerShell 7+ または bash。

---

## 0. 全体像

FlameNode は次の構成で動きます。

| レイヤー | 実体 | デプロイ方法 |
| --- | --- | --- |
| Web アプリ (Next.js 15 / Auth.js) | Cloudflare Pages | `@cloudflare/next-on-pages` でビルドし `wrangler pages deploy` |
| SQL データベース | Cloudflare D1 (`flamenode_db`) | `wrangler d1 create` → `wrangler d1 migrations apply` |
| オブジェクトストレージ | Cloudflare R2 (`flamenode-storage`) | `wrangler r2 bucket create` |
| キャッシュ / フラグ | Cloudflare KV (`KV`) | `wrangler kv namespace create` |
| 定期処理 (3 Cron) | Cloudflare Workers + Cron Triggers | `npm run workers:deploy`（`fast-jobs` / `content-jobs` / `sync-jobs`） |

無料枠の Cron は **アカウント全体で 5 個まで**です。本リポジトリは **3 Cron**（統合 Worker 3 本）で運用し、旧 5 本構成のモジュールは `workers/json-generator` などから import するだけです。

---

## 1. 一度だけ済ませる準備

### 1-1. 必要ツールのインストール

```powershell
# Node.js 22.x
node -v          # v22.x であること
npm -v
npx wrangler --version
```

### 1-2. Cloudflare にログイン

```powershell
wrangler login
```
ブラウザが開くので、FlameNode を運用するアカウントを選択して許可してください。

### 1-3. リポジトリのクローンと依存導入

```powershell
git clone https://github.com/<your-org>/flamenode.git
cd flamenode
npm install
```

### 1-4. Pages 用ビルドアダプタ (導入済み)

Next.js 15 のサーバ機能を Cloudflare Pages で動かすための [`@cloudflare/next-on-pages`](https://github.com/cloudflare/next-on-pages) は、**すでに devDependencies に含まれており**、`npm install` だけで揃います。追加作業は不要です。

`package.json` には次のスクリプトが定義済みです。

| スクリプト | 内容 |
| --- | --- |
| `npm run pages:build` | `scripts/run-next-on-pages.cjs` (Windows 対応ラッパー) でビルド後、`scripts/pages-postbuild.mjs` を実行 |
| `npm run pages:dev` | ビルドして `wrangler pages dev` で本番相当のランタイム起動 (D1/R2/KV は Miniflare) |
| `npm run pages:deploy` | ビルドして `wrangler pages deploy --project-name=flamenode` |

成果物は `.vercel/output/static` に出力され、`wrangler.toml` の `pages_build_output_dir` もこれに合わせてあります。

---

## 2. Cloudflare 上にリソースを作る

ここで作成したリソース ID を `wrangler.toml` 系へ反映します。

### 2-1. D1 データベースを作成

```powershell
wrangler d1 create flamenode_db
```

出力例:

```
✅ Successfully created DB 'flamenode_db'
[[d1_databases]]
binding = "DB"
database_name = "flamenode_db"
database_id = "abcdef01-2345-6789-abcd-ef0123456789"
```

`database_id` をコピーし、**以下のすべてのファイル**で `00000000-0000-0000-0000-000000000000` をその値に置き換えてください。

- `wrangler.toml`
- `workers/fast-jobs/wrangler.toml`
- `workers/content-jobs/wrangler.toml`
- `workers/sync-jobs/wrangler.toml`

### 2-2. R2 バケットを作成

```powershell
wrangler r2 bucket create flamenode-storage
```

`wrangler.toml` の `r2_buckets.bucket_name` (`flamenode-storage`) は既に合っているので変更不要です。

### 2-3. KV ネームスペースを作成

本番用とプレビュー用を分けると便利です。

```powershell
wrangler kv namespace create FLAMENODE_KV
wrangler kv namespace create FLAMENODE_KV --preview
```

それぞれ表示される `id` / `preview_id` を、以下に貼り替えます (`00000000000000000000000000000000` の部分)。

- `wrangler.toml` (Pages 用)
- `workers/fast-jobs/wrangler.toml`
- `workers/content-jobs/wrangler.toml`
- `workers/sync-jobs/wrangler.toml`

### 2-4. (任意) ドメインを Cloudflare に乗せる

独自ドメインで運用する場合は、Cloudflare Dashboard でゾーンを追加し、ネームサーバを切り替えてください。後で Pages プロジェクトのカスタムドメイン設定で使用します。

---

## 3. データベースの初期化

Remote D1の作成、backup、migration適用、rollbackは運用者が対象D1とbackupを確認したうえで手動実行する。CI、Codex、Pages deployはRemote D1を自動変更しない。

### 3-1. マイグレーション SQL の確認

active migrationは `migrations/` 直下の `.sql` をファイル名順に適用します。ファイル名を文書へ固定列挙せず、次のコマンドで実体を確認してください。

```powershell
Get-ChildItem migrations -File -Filter *.sql | Sort-Object Name
```

```bash
find migrations -maxdepth 1 -type f -name '*.sql' | sort
```

DBスキーマの正本は `src/lib/db/schema.ts` です。旧migrationは `migrations/historical/` に保存し、現行環境へ再適用しません。

### 3-2. 本番 D1 へマイグレーション適用

```powershell
wrangler d1 migrations apply flamenode_db --remote
```

適用前に `npm.cmd run check:db-schema` と `npm.cmd run check:db-history` を実行し、対象migrationとbackupを記録してください。旧migrationは `migrations/historical/` に保存されたHistorical資料で、現行runtimeのfallbackや二重書き込みには使用しません。

ローカル開発用 (Miniflare) には:

```powershell
wrangler d1 migrations apply flamenode_db --local
```

### 3-3. (任意) 旧データの取り込み

旧 EventArchives の CSV / JSON を取り込む場合は、ログイン後に `/admin/import` から実行できます。
ファイルが大きい場合は事前に R2 へ置き、ジョブで分割処理してください。

---

## 4. Discord OAuth の設定

Auth.js (NextAuth v5) は **Discord 1 プロバイダ**だけを使います。

1. https://discord.com/developers/applications にアクセスし、**New Application** で `FlameNode` を作成。
2. `OAuth2` → `Redirects` に次を追加:
   - 本番: `https://<あなたのドメイン>/api/auth/callback/discord`
   - プレビュー: `https://<pages-project>.pages.dev/api/auth/callback/discord`
   - ローカル: `http://localhost:3000/api/auth/callback/discord`
3. `OAuth2` 画面の `Client ID` / `Client Secret` を控える。
4. `Bot` タブは不要。Scope は `identify email guilds` のみ使用します。

---

## 5. シークレット (環境変数) の登録

シークレットは `wrangler.toml` には書かず、**`wrangler secret put` で登録**します。

### 5-1. Pages (Web 本体) のシークレット

```powershell
# Auth.js
wrangler pages secret put AUTH_SECRET            # `openssl rand -hex 32` で作成した値
wrangler pages secret put SPREADSHEET_IMPORT_PREVIEW_SECRET # 独立した32文字以上のランダム値
wrangler pages secret put AUTH_DISCORD_ID
wrangler pages secret put AUTH_DISCORD_SECRET

# 本番 URL (Auth.js が cookie ドメインに使う)
wrangler pages secret put NEXTAUTH_URL           # 例: https://flamenode.example.com

# YouTube Data API (任意。OGP フォールバックがあるので無くても起動する)
wrangler pages secret put YOUTUBE_API_KEY
```

> `wrangler pages secret put <NAME>` は対話式で値を聞いてくるので、コピーして貼り付けてください。
> Cloudflare Dashboard の **Pages → プロジェクト → Settings → Environment variables** からも追加できます。
> 必ず **Production** と **Preview** の双方に設定してください。

`SPREADSHEET_IMPORT_PREVIEW_SECRET`は`AUTH_SECRET`やlegacy import用secretと共用しません。未設定時のSpreadsheet dry-run/applyはfail-closedが正しい動作です。

### 5-2. Workers のシークレット

`sync-jobs`（YouTube 同期）で YouTube API キーが必要です。

```powershell
cd workers/sync-jobs
wrangler secret put YOUTUBE_API_KEY
cd ../..
```

`fast-jobs`（通知ディスパッチ）で Discord Webhook / Bot を使う場合:

```powershell
cd workers/fast-jobs
wrangler secret put DISCORD_WEBHOOK_URL
wrangler secret put DISCORD_BOT_TOKEN
cd ../..
```

legacy importを一時的に有効化する場合は、Pages側へ次の2値を登録します。通常運用では `ENABLE_LEGACY_IMPORT_TOOL` を未設定または `false` にします。

```powershell
wrangler pages secret put ENABLE_LEGACY_IMPORT_TOOL
wrangler pages secret put LEGACY_IMPORT_PREVIEW_SECRET
```

`LEGACY_IMPORT_PREVIEW_SECRET` は32文字以上のランダム値とし、ログ・監査snapshot・Issueへ出力しません。import完了後はsecretをローテーションまたは無効化します。

### 5-3. ローカル開発用 `.dev.vars`

ローカルで `wrangler pages dev` するときは、リポジトリ直下に `.dev.vars` (gitignore 済み) を作成します。

```env
AUTH_SECRET=（32 バイトのランダム文字列）
AUTH_DISCORD_ID=...
AUTH_DISCORD_SECRET=...
NEXTAUTH_URL=http://localhost:3000
YOUTUBE_API_KEY=...
# メンテナンスモード強制テスト用
MAINTENANCE_MODE=0
```

---

## 6. Pages へ Web 本体をデプロイ

### 6-1. ビルド & 初回デプロイ

```powershell
npm run pages:build
npx wrangler pages deploy .vercel/output/static --project-name=flamenode
```

初回は `--project-name` で Pages プロジェクトを作成します。プロンプトで Production ブランチ (例: `main`) を聞かれます。

### 6-2. プロジェクトに Bindings を紐付け

Cloudflare Dashboard → **Pages → flamenode → Settings → Functions** で次の Bindings を追加してください。**`wrangler.toml` の Bindings は Pages では自動反映されません。Dashboard 側にも同じものを入れる必要があります。**

| Type | Variable name | 紐付ける対象 |
| --- | --- | --- |
| D1 database | `DB` | `flamenode_db` |
| R2 bucket | `BUCKET` | `flamenode-storage` |
| KV namespace | `KV` | 2-3 で作った KV |

### 6-3. カスタムドメイン

Dashboard → **Pages → flamenode → Custom domains** からドメインを追加し、Cloudflare 側で DNS が自動解決されるのを待ちます。HTTPS 証明書も自動発行されます。

ドメイン確定後は Discord Developer Portal の Redirect URI を本番ドメインへ更新してください (4 章)。

---

## 7. Workers (Cron) のデプロイ

3 つの統合 Worker をデプロイします。ルートから一括実行するのが簡単です。

```powershell
npm run workers:deploy
```

個別にデプロイする場合:

```powershell
cd workers/fast-jobs    ; wrangler deploy ; cd ../..
cd workers/content-jobs ; wrangler deploy ; cd ../..
cd workers/sync-jobs    ; wrangler deploy ; cd ../..
```

各 Worker のスケジュールは次のとおりです (合計 3 Cron):

| Worker | Cron | 役割（統合元モジュール） |
| --- | --- | --- |
| `flamenode-fast-jobs` | `*/5 * * * *` | 通知ディスパッチ・スロット締切リマインド（`notification-dispatcher`） |
| `flamenode-content-jobs` | `*/15 * * * *` | 静的 JSON 再生成・クリーンアップ（`json-generator` / `cleanup`） |
| `flamenode-sync-jobs` | `0 */12 * * *` | YouTube 同期・スコア再計算（`youtube-sync` / `score-recalc`） |

> Cron 起動を手元から検証するには、Dashboard → **Workers → 各 Worker → Triggers → Send test event** で `scheduled` を選んで実行できます。

---

## 8. 初期データを入れる

### 8-1. 自分を管理者に昇格

Discord でログインしたあと、D1 を直接更新します。

```powershell
# 自分のレコードを確認
wrangler d1 execute flamenode_db --remote --command "SELECT id, name, role FROM user;"

# 管理者へ
wrangler d1 execute flamenode_db --remote --command "UPDATE user SET role='admin' WHERE discord_id='<your-discord-id>';"
```

### 8-2. system_settings の初期化

```powershell
wrangler d1 execute flamenode_db --remote --command "INSERT INTO system_settings (id, operation_mode) VALUES ('default', 'normal') ON CONFLICT(id) DO UPDATE SET operation_mode=excluded.operation_mode;"
```

### 8-3. 利用規約の最初の版

`/admin/rules` から最新版の利用規約を 1 件投入してください。これがないと新規ユーザーの ToS 同意フローが空になります。

---

## 9. 動作確認チェックリスト

本番デプロイ直後に以下を順に確認してください。

- [ ] `https://<本番ドメイン>/` にアクセスし、フレームのトップが表示される
- [ ] `Discord でログイン` が成功する
- [ ] `/dashboard` で自分の Discord ユーザー名が表示される
- [ ] `/entry` から自由投稿ができる (動画詳細にリダイレクトされる)
- [ ] `/admin` (管理者ロール) に入れて、コストガード状態が `normal` と表示される
- [ ] `/admin/cost-guard` から `economy` → `normal` の切替ができる
- [ ] `/admin/cost-guard` で機能別の一時許可が15分で失効し、設定・解除が監査ログに残る
- [ ] `wrangler tail` で Pages のリクエストログが出る
- [ ] `wrangler tail flamenode-content-jobs` で 15 分以内に Cron 起動ログが出る
- [ ] `https://<本番ドメイン>/maintenance` が表示できる

---

## 10. 運用中のよくある操作

### 10-1. 緊急のメンテナンス切替

通常は管理者が `/admin/cost-guard` のメンテナンス専用操作から、理由を入力して切り替えます。通常のコストガードモード変更とは別の操作で、どちらも監査ログへ記録されます。

管理画面へ入れない緊急時だけ、次の SQL を使用します。直接 SQL はアプリの監査処理を通らないため、実行者・理由・時刻を別途運用記録へ残してください。

```powershell
# 即時メンテナンスモード
wrangler d1 execute flamenode_db --remote --command "UPDATE system_settings SET operation_mode='maintenance' WHERE id='default';"

# 解除
wrangler d1 execute flamenode_db --remote --command "UPDATE system_settings SET operation_mode='normal' WHERE id='default';"
```

Cloudflare 使用量を自動収集してモードを切り替える処理はありません。Cloudflare Dashboard の使用量を運用者が確認し、必要な場合だけ `/admin/cost-guard` から手動変更してください。

### 10-2. 環境変数だけで一時的にメンテナンス画面へ

DB を触らず、Pages の環境変数 `MAINTENANCE_MODE=1` を設定すると、`middleware.ts` がすべてのアクセスを `/maintenance` にリダイレクトします。設定後は `Pages → Deployments → Retry build` で再ビルドが必要です。

### 10-3. ロールバック

Cloudflare Pages は **過去のデプロイを 1 クリックでロールバック**できます。
Dashboard → **Pages → flamenode → Deployments → 該当行の「…」→ Rollback to this deployment**。

### 10-4. データバックアップ

D1 はマネージドですが、念のため週 1 で SQL ダンプを取ります。

```powershell
wrangler d1 export flamenode_db --remote --output=backup-$(Get-Date -Format yyyyMMdd).sql
```

R2 のオブジェクトは `wrangler r2 object` または `rclone` で別バケット / 外部ストレージへコピーしてください。

### 10-5. Legacy import / cleanup

legacy importはpreview → 承認済みapply → audit確認の順で実行します。対象ファイル、preview、batch結果、警告を記録し、途中失敗時に直接再実行しません。期限切れpreview・一時ファイル・不要な入力artifactはretentionを確認してcleanupし、active D1の正本データやaudit_logsを無差別削除しません。静的JSONの古いartifact cleanupは `content-jobs` の制限付き処理に任せます。

---

## 11. ローカル開発フロー (参考)

```powershell
# 1. ローカル D1 にマイグレーション適用
wrangler d1 migrations apply flamenode_db --local

# 2. ローカル開発サーバ
npm run dev                          # 純粋な Next.js dev (D1 が無い限定モード)
# もしくは
npm run pages:build
npm run pages:dev                    # Pages の本番に近いランタイムで起動
```

`http://localhost:3000` にアクセスして動作確認できます。Discord OAuth の Redirect URI に `http://localhost:3000/api/auth/callback/discord` を追加するのを忘れずに。

---

## 12. CI/CD (検査のみ)

CIではPages build、文書検査、Worker dry-runなどの検証だけを行います。Remote D1 migrationと本番Pages/Worker deployは、同一commitと検査結果を確認した運用者が手動で実行します。Git連携を使う場合も、Remote D1を自動適用する設定は追加しません。

Cloudflare Dashboard → **Pages → Connect to Git** を使う場合のbuild設定は次のとおりです。

```text
Build command:        npx @cloudflare/next-on-pages
Build output directory: .vercel/output/static
Root directory:       /
Environment variables: AUTH_SECRET, SPREADSHEET_IMPORT_PREVIEW_SECRET, AUTH_DISCORD_ID, AUTH_DISCORD_SECRET, NEXTAUTH_URL, YOUTUBE_API_KEY
```

Workers の自動デプロイは GitHub Actions の `cloudflare/wrangler-action@v3` を使うのが簡単です。シークレットは GitHub の Secret に格納し、`CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit 権限) を渡してください。

---

## 13. 失敗したときに確認する場所

| 症状 | 見るところ |
| --- | --- |
| ログインできない | Discord Developer Portal の Redirect URI、`AUTH_SECRET`、`NEXTAUTH_URL`、Pages の Bindings に `DB` が刺さっているか |
| 「DB に接続できません」とフォームが返す | Pages → Settings → Functions の D1 binding (`DB`) が `flamenode_db` を指しているか |
| トップページが空 | `flamenode-content-jobs` Worker の Cron 実行が成功しているか (`wrangler tail`)。R2 / KV に書き込み権限があるか |
| 502 / 1101 エラー | `wrangler tail` で Functions のスタックトレースを確認。`compatibility_flags = ["nodejs_compat"]` が消えていないか |
| Cron が動かない | `wrangler.toml` (worker) の `[triggers] crons` と Dashboard → Triggers が一致しているか。アカウント全体で 6 個以上になっていないか |
| Auth.js のエラー `MissingSecret` | `AUTH_SECRET` が Production / Preview の両方に設定されているか |

---

## 14. 完了

ここまで完了すれば、FlameNode は **Cloudflare 無料枠を中心に動く本番運用**へ載せられます。
追加の運用作業 (利用規約改定、コストガードしきい値の調整、X ID 連携承認) はすべて `/admin` 配下の UI から実行できます。
