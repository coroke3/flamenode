# FlameNode ローカル動作手順書

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `e772cc9`
> Source of truth: `package.json`, `migrations/` active path, `docs/operations/migrations.md`

このドキュメントは、FlameNode を **手元の PC で動かして動作確認する**ための手順をまとめたものです。
本番デプロイ手順は `DEPLOY.md` を参照してください。ここではローカルで完結する作業だけを扱います。

## 最短起動手順

前提はNode.js 22.xです。

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
npm run db:local-apply
npm run dev
```

macOS / Linux:

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:local-apply
npm run dev
```

起動後、`http://localhost:3000/`を開きます。

Discordログインを確認する場合は、`.dev.vars`へ次を設定してください。

* `AUTH_SECRET`
* `AUTH_DISCORD_ID`
* `AUTH_DISCORD_SECRET`
* `AUTH_URL`
* `NEXT_PUBLIC_SITE_URL`

---

## 1. 前提ツール

| ツール | バージョン | 確認コマンド |
| --- | --- | --- |
| Node.js | 22.x | `node -v` |
| npm | Node.js 22同梱版 | `npm -v` |
| wrangler | `package-lock.json`固定版 | `npx wrangler --version` |
| Git | 任意 | `git --version` |

> グローバルに `wrangler` を入れる必要はありません。本リポジトリは `npx wrangler` で十分動きます。

---

## 2. 初回セットアップ (5 〜 10 分)

### 2-1. クローンと依存導入

> **すでに手元にこのリポジトリがある場合 (Cursor で開いている場合など) はこの節をスキップ**してください。
> 確認方法: 作業ディレクトリで `Test-Path package.json` が `True`、かつ `Test-Path .git` が `True` ならクローン済みです。

```powershell
# まだクローンしていない場合のみ:
git clone https://github.com/<your-org>/flamenode.git
cd flamenode
npm install
```

> Windows で `git : 用語 'git' は…認識されません` と出る場合、Git が PATH に無いだけです。
> ローカルで動かす目的だけなら **Git の追加導入は必須ではありません** (Cursor が Git 操作を担当します)。
> CLI から Git を使いたい場合は次のいずれかで導入できます。
> ```powershell
> winget install --id Git.Git -e
> # または https://git-scm.com/download/win から MSI を取得
> ```
>
> `npm install` を一度実行済みであれば `node_modules` フォルダが作られています (`Test-Path node_modules` が `True`)。
> その場合は再実行不要です。

### 2-2. ローカル用環境変数 (`.dev.vars`) の作成

リポジトリには `.dev.vars.example` が含まれており、実体の `.dev.vars` は `.gitignore` 対象です。コピーして編集してください。

```powershell
# Windows PowerShell
Copy-Item .dev.vars.example .dev.vars

# macOS / Linux
cp .dev.vars.example .dev.vars
```

最低限、以下を埋めれば動きます。Discord OAuth が無くても UI 確認は可能ですが、ログインフローを確認するには必須です。

```env
# .dev.vars
AUTH_SECRET="<openssl rand -hex 32 で生成した値>"
SPREADSHEET_IMPORT_PREVIEW_SECRET="<独立した32文字以上のランダム値>"
AUTH_TRUST_HOST="true"

AUTH_DISCORD_ID="<Discord Developer Portal の Client ID>"
AUTH_DISCORD_SECRET="<Discord Developer Portal の Client Secret>"

# legacy importを使う場合だけ設定（通常は無効）
ENABLE_LEGACY_IMPORT_TOOL="false"
LEGACY_IMPORT_PREVIEW_SECRET=""

# OAuth のリダイレクト組み立てに必須。`npm run dev:local` でポートを変えたらここも合わせる
AUTH_URL="http://localhost:3000"

NEXT_PUBLIC_SITE_URL="http://localhost:3000"
NEXT_PUBLIC_SITE_NAME="FlameNode"
```

`AUTH_SECRET` の生成例:

```powershell
# PowerShell
[Convert]::ToHexString((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
# bash
openssl rand -hex 32
```

### 2-3. ビルドアダプタについて (追加作業なし)

`@cloudflare/next-on-pages` は devDependencies に含まれており、`pages:build` / `pages:dev` / `pages:deploy` スクリプトも `package.json` に定義済みです。`npm install` 以外の準備は不要です。

---

## 3. モード A: 通常開発 (`next dev` + Miniflare 内蔵)

```powershell
npm run dev
```

ブラウザで http://localhost:3000/ を開きます。

### 期待される挙動

- `instrumentation.ts` が起動時にMiniflare bindingを立ち上げ、D1 / R2 / KV が `.wrangler/state/v3` を使ってローカル再現される
- ローカルD1のschemaは起動前に `npm.cmd run db:local-apply` で手動適用する。schema不一致はfail-fastで扱う
- Discord OAuth 設定済みならログイン・投稿・管理画面まで一通り動作する

日常の開発はこのモードで完結します。next-on-pages ビルド後の edge ランタイム固有の問題を確認したいときだけ、次のモード B を使います。

---

## 4. モード B: 本番相当 (`wrangler pages dev` + Miniflare)

### 4-1. ローカル D1 にスキーマを流し込む

```powershell
# .wrangler 配下にローカル SQLite を作成し、active baselineを適用
npx wrangler d1 migrations apply flamenode_db --local
```

> 「flamenode_db を作りますか?」と聞かれたら yes。`wrangler.toml` の `database_name` がそのまま使われます。
> ローカル D1 は本番とは完全に独立した別の SQLite ファイルなので、自由に試して大丈夫です。

### 4-2. アダプタ経由で起動

```powershell
npm run pages:dev
```

初回は `.vercel/output/static` を生成するのに 30 秒〜1 分ほどかかります。完了すると wrangler が次のように出力します:

```
✨ Compiled Worker successfully
[mf:inf] Ready on http://127.0.0.1:8788/
```

ブラウザで http://localhost:8788/ を開きます。

### 4-3. 期待される挙動

- D1 / R2 / KV がすべて Miniflare 上で稼働 (本番と同じ API を再現)
- Discord でログインができる (Discord Developer Portal で `http://localhost:8788/api/auth/callback/discord` を Redirect に登録しておくこと)
- フォーム送信が成功し、D1 にレコードが追加される
- `wrangler tail` 相当のリクエストログがコンソールに流れる

> **注意**: `npm run dev` (3000 番) と `npm run pages:dev` (8788 番) は **ポートも cookie ドメインも違います**。Discord の Redirect URI は両方とも登録しておくと便利です。

### 4-4. ローカル DB の中身を確認 / 操作

```powershell
# テーブル一覧
npx wrangler d1 execute flamenode_db --local --command "SELECT name FROM sqlite_master WHERE type='table';"

# 自分のレコードを確認 (ログイン後)
npx wrangler d1 execute flamenode_db --local --command "SELECT id, name, role FROM user;"

# 自分を管理者へ昇格 (`/admin` に入りたい場合)
npx wrangler d1 execute flamenode_db --local --command "UPDATE user SET role='admin' WHERE id='<上で得た id>';"

# system_settings の初期化 (まだ無ければ)
npx wrangler d1 execute flamenode_db --local --command "INSERT INTO system_settings (id, operation_mode) VALUES ('default', 'normal') ON CONFLICT(id) DO UPDATE SET operation_mode=excluded.operation_mode;"
```

GUI で見たい場合は Drizzle Studio を使えます (本番 D1 ではなく D1-HTTP 接続なので、ローカル運用では一時的な参照に使う想定です):

```powershell
npm run db:studio
```

---

## 5. Discord OAuth をローカルで動かす

1. https://discord.com/developers/applications を開き、テスト用アプリ (例: `FlameNode-Local`) を作成
2. **OAuth2 → Redirects** に次の 2 つを追加
   - `http://localhost:3000/api/auth/callback/discord`
   - `http://localhost:8788/api/auth/callback/discord`
3. **OAuth2** 画面の `Client ID` / `Client Secret` を `.dev.vars` の `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` に貼る
4. `npm run pages:dev` を再起動 (`.dev.vars` の変更は再起動で反映)

> 本番アプリと同じクライアントを使うとサインインユーザーが混ざるので、ローカル用は別の Discord アプリにすることを強く推奨します。

## 6. Legacy import のローカル確認

legacy importは通常無効です。確認時だけ `.dev.vars` に次を設定し、サーバーを再起動します。

```env
ENABLE_LEGACY_IMPORT_TOOL="true"
LEGACY_IMPORT_PREVIEW_SECRET="32文字以上のローカル専用ランダム値"
```

`/admin/import` は管理者認証、preview、署名token、入力hash一致を要求します。secretはGitへコミットせず、検証後は一時ファイルとローカル状態をcleanupします。

---

## 7. メンテナンスモード / コストガードの確認

### 6-1. middleware による即時メンテナンス

`.dev.vars` に次を追加して再起動すると、`/maintenance` 以外のすべてのアクセスがリダイレクトされます。設計図のメンテナンス挙動を確認したいときに使ってください。

```env
MAINTENANCE_MODE=1
```

### 6-2. DB 経由のコストガード

```powershell
# economy にする
npx wrangler d1 execute flamenode_db --local --command "UPDATE system_settings SET operation_mode='economy' WHERE id='default';"

# normal に戻す
npx wrangler d1 execute flamenode_db --local --command "UPDATE system_settings SET operation_mode='normal' WHERE id='default';"
```

管理者でログインしている場合は `/admin/cost-guard` から UI で操作できます。
`/admin/cost-guard` では現在の `operation_mode`、変更理由、直近の監査ログ、一時例外の期限を確認できます。モードは管理者が手動で変更し、機能別の一時許可は確認文字列と理由を要求したうえで15分だけ有効です。メンテナンスへの移行・解除は通常のモード変更とは分離された専用操作です。

Cloudflare 使用量の自動収集、推奨 mode の自動計算、自動昇格は実装していません。必要な場合は Cloudflare Dashboard を確認して手動で判断してください。

### 6-3. 管理画面 DB スプレッドシート (オプション)

`.dev.vars` に `ADMIN_SPREADSHEET_ENABLED="true"` を設定し、管理者でログインすると `/admin/spreadsheet` がサイドバーに表示されます。D1 テーブルを表形式で閲覧・編集できます（認証トークン列はマスク・編集不可、`audit_logs` は読み取り専用）。

CSV / TSV: ツールバーからエクスポート（ダウンロード・クリップボード）とインポート（貼り付け・ファイル・区切り自動/CSV/TSV・ヘッダー行・UPSERT/INSERT）が使えます。インポートは最大 500 行、エクスポートは最大 5000 行です。

---

## 7. Worker (Cron) のローカル実行

`workers/fast-jobs`、`workers/content-jobs`、`workers/sync-jobs` の 3 つの統合 Worker は、それぞれ単独で `wrangler dev` できます。Cron トリガを再現したい場合は `--test-scheduled` を付けて起動し、`/__scheduled` エンドポイントを叩きます。

```powershell
# 例: 静的 JSON 再生成 (content-jobs)
cd workers/content-jobs
npx wrangler dev --test-scheduled --local
# 別ターミナルで
curl "http://127.0.0.1:8787/__scheduled?cron=*/15+*+*+*+*"
cd ../..
```

本番MVPの実スケジュールは、content-jobs が15分ごと、sync-jobs が12時間ごと、fast-jobs が5分ごとです。ローカルで `__scheduled` を叩く場合は、確認対象 Worker の `wrangler.toml` に書かれた cron 文字列に合わせてください。

ローカル D1 / KV を共有させるには、`workers/<name>/wrangler.toml` の `database_id` / KV `id` をそのままにしておけば、Pages 側と同じ Miniflare ストレージ (`.wrangler/state`) を使います。

> 3 つの Worker を同時に立てる必要はほぼありません。確認したい Worker だけ起動するのが普通です。

---

## 8. テストデータを入れる

ログインしてフォームから投稿するのが一番手軽ですが、SQL で直接入れるならこんな感じです (ローカル DB のみ)。

```powershell
# サンプルイベントを 1 件
npx wrangler d1 execute flamenode_db --local --command @"
INSERT INTO events (id, title, explanation, start_time, end_time, visibility_status, created_at, updated_at)
VALUES ('ev_demo', 'デモイベント', 'ローカル動作確認用', strftime('%s','now') - 3600, strftime('%s','now') + 7*24*3600, 'public', strftime('%s','now'), strftime('%s','now'));
"@

# サンプル動画を 1 件
npx wrangler d1 execute flamenode_db --local --command @"
INSERT INTO videos (id, submitted_by_user_id, submission_type, display_name, creator_x_user_id, title, youtube_video_id, visibility_status, scheduling_type, scheduled_time, created_at, updated_at)
VALUES ('v_demo', '<your-user-id>', 'individual', 'デモ作者', 'demo', 'デモ作品', 'dQw4w9WgXcQ', 'public', 'manual', strftime('%s','now'), strftime('%s','now'), strftime('%s','now'));
"@
```

> `<your-user-id>` は `SELECT id FROM user;` で取得するAuth.js内部ユーザーIDです。Discord Snowflakeは `user.discord_id` にだけ保存します。

サンプル投入後にトップ (http://localhost:8788/) を再読み込みすると、デモ作品とイベントが表示されます。

---

## 9. ローカル DB のリセット

「最初の状態に戻したい」「migration をやり直したい」というときは、`.wrangler` ディレクトリを消して再生成します。

```powershell
# Windows
Remove-Item -Recurse -Force .wrangler

# macOS / Linux
rm -rf .wrangler
```

その後、再度マイグレーションを適用します。

```powershell
npx wrangler d1 migrations apply flamenode_db --local
```

---

## 10. よく使うコマンド早見表

| 目的 | コマンド |
| --- | --- |
| 依存導入 | `npm install` |
| 通常開発 (フル動作) | `npm run dev` (http://localhost:3000) |
| 本番相当ランタイム | `npm run pages:dev` (http://localhost:8788) |
| 型チェック (アプリ) | `npm run typecheck` |
| 型チェック (Workers) | `npx tsc --noEmit -p workers` |
| Lint | `npm run lint` |
| 本番ビルド検証 | `npx next build` |
| ローカル DB マイグレーション | `npx wrangler d1 migrations apply flamenode_db --local` |
| ローカル DB に SQL 実行 | `npx wrangler d1 execute flamenode_db --local --command "..."` |
| ローカル DB を GUI で見る | `npm run db:studio` |
| schema 変更時の migration | 手動 SQL を `migrations/` に追加 (自動生成は使わない。docs/operations/migrations.md 参照) |
| ローカルストレージ全消し | `Remove-Item -Recurse -Force .wrangler` |

---

## 11. トラブルシュート

| 症状 | 原因と対処 |
| --- | --- |
| `npm run dev` で「DB に接続できません」 | Miniflare 起動失敗の可能性。ターミナルの instrumentation ログを確認。`LOCAL_BINDINGS=0` が設定されていないかも確認 |
| `npm run pages:dev` 起動時に `D1_ERROR: no such table` | ローカル D1 にマイグレーションがあたっていない。`npx wrangler d1 migrations apply flamenode_db --local` を実行 |
| Discord ログインで `redirect_uri_mismatch` | Discord Developer Portal の Redirect に `http://localhost:3000/api/auth/callback/discord` が無い |
| `/entry?error=Configuration` と `Invalid URL` (auth) | `AUTH_URL` または `NEXTAUTH_URL` が未設定。`.dev.vars` に `AUTH_URL="http://localhost:3000"` を追加するか、`NEXT_PUBLIC_SITE_URL` を正しい絶対 URL にする |
| ログイン後に `/dashboard` で 500 | `user` テーブルにカラムが足りていない可能性。`.wrangler` を消して再マイグレーション |
| `/admin` に弾かれる | `role` が `user` のまま。SQL で自分を `admin` にする (4-4 参照) |
| Cookie がブラウザに残ってログイン状態が変 | DevTools → Application → Cookies で `localhost:8788` を全削除して再試行 |
| `pages:dev` のビルドが遅い | 初回のみ `@cloudflare/next-on-pages` が依存解析するため。2 回目以降は数秒〜十数秒で起動 |
| `.dev.vars` を編集しても反映されない | `pages:dev` を Ctrl+C で止めて再起動が必要 |
| Windows で `&&` が使えない | PowerShell では `;` で繋ぐか、コマンドを 1 行ずつ実行 |
| `Cannot find module './vendor-chunks/...'` エラー | 本番ビルド (`npm run build`) と開発モードのキャッシュ競合。`npm run clean:next` または `npm run dev:clean` を実行して `.next` キャッシュを削除 |


---

## 12. ローカルで触る順番 (おすすめ)

1. `npm install`
2. `.dev.vars` を `.dev.vars.example` から作る
3. `npx wrangler d1 migrations apply flamenode_db --local`
4. `npm run pages:dev` で http://localhost:8788/ を表示
5. Discord でログイン → `SELECT id, discord_id FROM user;` で内部ユーザーIDとDiscord Snowflakeの分離を確認 → 自分を `admin` に昇格
6. `/admin` に入って画面遷移を確認
7. `/entry` から投稿してトップに反映されるかを確認
8. 必要に応じて `MAINTENANCE_MODE=1` や `operation_mode='economy'` の挙動を確認

ここまで通れば、**本番 (`DEPLOY.md`) で同じ操作が成り立つ前提**が手元で再現できたことになります。
