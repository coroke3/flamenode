# FlameNode ローカル動作手順書

このドキュメントは、FlameNode を **手元の PC で動かして動作確認する**ための手順をまとめたものです。
本番デプロイ手順は `DEPLOY.md` を参照してください。ここではローカルで完結する作業だけを扱います。

> **このリポジトリでの実施状況 (自動セットアップ済み)**
>
> - [x] `npm install` 完了
> - [x] `.dev.vars` を作成、`AUTH_SECRET` 自動生成済み
> - [x] Git for Windows (bash 同梱) を `winget install` で導入
> - [x] `@cloudflare/next-on-pages` を試したが Windows で不安定なため **Miniflare 内蔵モード**に切替
> - [x] `instrumentation.ts` を追加し、`next dev` 起動時に Miniflare で D1/R2/KV を自動起動
> - [x] 起動時にローカル D1 へマイグレーションを冪等 apply、`system_settings` も自動シード
> - [x] `npm run dev:local` で起動できる状態 (http://localhost:3000/、`/list`, `/event`, `/api/videos`, `/api/auth/providers` すべて 200 で応答することを確認済み)
> - [ ] **要対応**: Discord Developer Portal でアプリを作り、`.dev.vars` の `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` を埋める
> - [ ] **要対応**: ログイン後、自分を `role='admin'` に SQL で昇格 (`/admin` を確認したい場合のみ)
>
> 残作業はこの 2 つだけです。詳細は本書の §5 と §6 を参照してください。

---

## ⭐ いま動かす最短手順

開発サーバはすでにバックグラウンドで起動済みです。停止したい/再起動したい場合は次のコマンドを使ってください。

```powershell
# 動作中のサーバを止める
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match "next.*dev|load-dev-vars" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 改めて起動 (Miniflare の D1/R2/KV が自動で立ち上がり、migrations も冪等に当たる)
npm run dev:local
```

ブラウザで http://localhost:3000/ にアクセスすると、トップ・一覧・イベント・規約・メンテナンスがすべて表示されます。
データはまだ空なので、ログインしてから `/dashboard/post` で投稿するとリアルタイムにトップへ反映されます。

> **想定環境**: Windows (PowerShell 7+) / macOS / Linux。Node.js 20 LTS 以上。
> ローカル動作モードは目的に応じて 2 種類あります。
>
> | モード | 起動コマンド | 主な用途 | D1 / R2 / KV / Auth.js |
> | --- | --- | --- | --- |
> | A. UI 専用 | `npm run dev` | デザイン確認、コンポーネント編集、レイアウト調整 | **使えない** (空 DB として扱う) |
> | B. フル動作 | `npm run pages:dev` | ログイン、投稿、管理画面、Worker 動作確認 | **すべて使える** (Miniflare で D1/R2/KV をローカル再現) |
>
> 普段の UI イテレーションはモード A、バックエンド込みで確認したいときはモード B、という使い分けが一番楽です。

---

## 1. 前提ツール

| ツール | バージョン | 確認コマンド | 備考 |
| --- | --- | --- | --- |
| Node.js | 20 LTS 以上 | `node -v` | https://nodejs.org/ |
| npm | 10 以上 | `npm -v` | Node.js に同梱 |
| wrangler | 3.99 以上 | `npx wrangler --version` | リポジトリの devDependencies で入る |
| Git | 任意 | `git --version` | クローンに必要 |

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
AUTH_TRUST_HOST="true"

AUTH_DISCORD_ID="<Discord Developer Portal の Client ID>"
AUTH_DISCORD_SECRET="<Discord Developer Portal の Client Secret>"

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

### 2-3. ビルドアダプタの導入 (モード B を使う場合のみ)

`wrangler pages dev` で Next.js を動かすには Cloudflare 公式アダプタが必要です。初回のみ追加してください。

```powershell
npm i -D @cloudflare/next-on-pages
```

そして `package.json` の `scripts` に次を追加します (DEPLOY.md と同じ):

```json
{
  "scripts": {
    "pages:build": "npx @cloudflare/next-on-pages",
    "pages:dev":   "npx @cloudflare/next-on-pages && npx wrangler pages dev .vercel/output/static --compatibility-flag=nodejs_compat --d1=DB --r2=BUCKET --kv=KV"
  }
}
```

> `--d1=DB --r2=BUCKET --kv=KV` を付けることで、Miniflare が **ローカル専用の D1 / R2 / KV** を自動で立ち上げ、`wrangler.toml` のバインディング名どおりに `env.DB` などを Next.js から参照できるようになります。データは `.wrangler/` 配下に永続化されます。

---

## 3. モード A: 純粋な UI 確認 (`next dev`)

```powershell
npm run dev
```

ブラウザで http://localhost:3000/ を開きます。

### 期待される挙動

- トップ、`/list`、`/event`、`/recommend`、`/rules`、`/maintenance` などの公開ページが表示される
- 動画 / イベントの中身は **空** のまま (D1 に接続できないため)
- ログインボタンを押しても OAuth は通らない (Auth.js の DB セッションが使えないため)
- フォームを送信すると `DB に接続できません` のエラーが返る

このモードはあくまで **CSS / レイアウト / コンポーネント実装の高速確認用**です。データを使った確認は次のモード B で行います。

---

## 4. モード B: フル動作 (`wrangler pages dev` + Miniflare)

### 4-1. ローカル D1 にスキーマを流し込む

```powershell
# .wrangler 配下にローカル SQLite を作成し、migrations/0000_brave_iceman.sql を適用
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
npx wrangler d1 execute flamenode_db --local --command "INSERT OR REPLACE INTO system_settings (id, cost_guard_mode, auto_cost_guard_enabled) VALUES ('default', 'normal', 1);"
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

---

## 6. メンテナンスモード / コストガードの確認

### 6-1. middleware による即時メンテナンス

`.dev.vars` に次を追加して再起動すると、`/maintenance` 以外のすべてのアクセスがリダイレクトされます。設計図のメンテナンス挙動を確認したいときに使ってください。

```env
MAINTENANCE_MODE=1
```

### 6-2. DB 経由のコストガード

```powershell
# economy にする
npx wrangler d1 execute flamenode_db --local --command "UPDATE system_settings SET cost_guard_mode='economy' WHERE id='default';"

# normal に戻す
npx wrangler d1 execute flamenode_db --local --command "UPDATE system_settings SET cost_guard_mode='normal' WHERE id='default';"
```

管理者でログインしている場合は `/admin/cost-guard` から UI で操作できます。

---

## 7. Worker (Cron) のローカル実行

`workers/` 配下の 5 つの Worker は、それぞれ単独で `wrangler dev` できます。Cron トリガを再現したい場合は `--test-scheduled` を付けて起動し、`/__scheduled` エンドポイントを叩きます。

```powershell
# 例: JSON ジェネレータ
cd workers/json-generator
npx wrangler dev --test-scheduled --local
# 別ターミナルで
curl "http://127.0.0.1:8787/__scheduled?cron=*/10+*+*+*+*"
cd ../..
```

ローカル D1 / KV を共有させるには、`workers/<name>/wrangler.toml` の `database_id` / KV `id` をそのままにしておけば、Pages 側と同じ Miniflare ストレージ (`.wrangler/state`) を使います。

> 5 つの Worker を同時に立てる必要はほぼありません。確認したい Worker だけ起動するのが普通です。

---

## 8. テストデータを入れる

ログインしてフォームから投稿するのが一番手軽ですが、SQL で直接入れるならこんな感じです (ローカル DB のみ)。

```powershell
# サンプルイベントを 1 件
npx wrangler d1 execute flamenode_db --local --command @"
INSERT INTO events (id, title, description, start_time, end_time, is_active, created_at)
VALUES ('ev_demo', 'デモイベント', 'ローカル動作確認用', strftime('%s','now') - 3600, strftime('%s','now') + 7*24*3600, 1, strftime('%s','now'));
"@

# サンプル動画を 1 件
npx wrangler d1 execute flamenode_db --local --command @"
INSERT INTO videos (id, owner_discord_user_id, submission_type, display_name, contact_x_id, title, youtube_video_id, status, scheduling_type, scheduled_time, created_at, updated_at)
VALUES ('v_demo', '<your-discord-id>', 'individual', 'デモ作者', 'demo', 'デモ作品', 'dQw4w9WgXcQ', 'public', 'manual', strftime('%s','now'), strftime('%s','now'), strftime('%s','now'));
"@
```

> `<your-discord-id>` は `SELECT id FROM user;` で取得できる Discord User ID です。

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
| UI だけ動かす | `npm run dev` (http://localhost:3000) |
| フル動作 | `npm run pages:dev` (http://localhost:8788) |
| 型チェック (アプリ) | `npm run typecheck` |
| 型チェック (Workers) | `npx tsc --noEmit -p workers` |
| Lint | `npm run lint` |
| 本番ビルド検証 | `npx next build` |
| ローカル DB マイグレーション | `npx wrangler d1 migrations apply flamenode_db --local` |
| ローカル DB に SQL 実行 | `npx wrangler d1 execute flamenode_db --local --command "..."` |
| ローカル DB を GUI で見る | `npm run db:studio` |
| schema → migration 再生成 | `npm run db:generate` |
| ローカルストレージ全消し | `Remove-Item -Recurse -Force .wrangler` |

---

## 11. トラブルシュート

| 症状 | 原因と対処 |
| --- | --- |
| `npm run dev` で「DB に接続できません」 | 想定どおり。D1 を使うならモード B (`npm run pages:dev`) を使う |
| `npm run pages:dev` 起動時に `D1_ERROR: no such table` | ローカル D1 にマイグレーションがあたっていない。`npx wrangler d1 migrations apply flamenode_db --local` を実行 |
| Discord ログインで `redirect_uri_mismatch` | Discord Developer Portal の Redirect に `http://localhost:3000/api/auth/callback/discord` が無い |
| `/entry?error=Configuration` と `Invalid URL` (auth) | `AUTH_URL` または `NEXTAUTH_URL` が未設定。`.dev.vars` に `AUTH_URL="http://localhost:3000"` を追加するか、`NEXT_PUBLIC_SITE_URL` を正しい絶対 URL にする（コード側でも `NEXT_PUBLIC_SITE_URL` から自動補完する） |
| ログイン後に `/dashboard` で 500 | `user` テーブルにカラムが足りていない可能性。`.wrangler` を消して再マイグレーション |
| `/admin` に弾かれる | `role` が `user` のまま。SQL で自分を `admin` にする (4-4 参照) |
| Cookie がブラウザに残ってログイン状態が変 | DevTools → Application → Cookies で `localhost:8788` を全削除して再試行 |
| `pages:dev` のビルドが遅い | 初回のみ `@cloudflare/next-on-pages` が依存解析するため。2 回目以降は数秒〜十数秒で起動 |
| `.dev.vars` を編集しても反映されない | `pages:dev` を Ctrl+C で止めて再起動が必要 |
| Windows で `&&` が使えない | PowerShell では `;` で繋ぐか、コマンドを 1 行ずつ実行 |

---

## 12. ローカルで触る順番 (おすすめ)

1. `npm install`
2. `.dev.vars` を `.dev.vars.example` から作る
3. `npx wrangler d1 migrations apply flamenode_db --local`
4. `npm run pages:dev` で http://localhost:8788/ を表示
5. Discord でログイン → 自分の Discord User ID を SQL で確認 → 自分を `admin` に昇格
6. `/admin` に入って画面遷移を確認
7. `/dashboard/post` から投稿してトップに反映されるかを確認
8. 必要に応じて `MAINTENANCE_MODE=1` や `cost_guard_mode='economy'` の挙動を確認

ここまで通れば、**本番 (`DEPLOY.md`) で同じ操作が成り立つ前提**が手元で再現できたことになります。
