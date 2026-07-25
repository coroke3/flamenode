# FlameNode ローカル動作手順書

> Status: Active
> Last verified: 2026-07-25
> Verified against commit: `dc46eefa`
> Source of truth: `package.json`, `.dev.vars.example`, `migrations/` active path, `wrangler.toml`, `docs/operations/migrations.md`

**AI:** 起動再現は §1–6 まで。検査の選び方は `docs/AI_CONTEXT.md` §検査の選び方。§7 の全列を毎回回さない。

この文書は個人PCの実施済み状態を前提にせず、空の作業環境からFlameNodeを再現する手順だけを扱います。本番操作は [`DEPLOY.md`](./DEPLOY.md) を参照してください。監査ログの正本テーブル名は `audit_logs` です。

## 1. 必要環境

- Node.js 22.x（`.nvmrc`と`package.json#engines`が正本）
- npm
- Git
- Windows PowerShell 7+、またはbash/zsh

Wranglerは`devDependencies`の固定版を使用します。グローバルinstallは不要です。

## 2. cloneと依存関係

```sh
git clone https://github.com/coroke3/flamenode.git
cd flamenode
npm ci
```

`npm install`でlockfileを更新しないでください。依存変更時だけ、意図した差分として`package.json`と`package-lock.json`を同時更新します。

## 3. ローカル環境変数

Windows PowerShell:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

macOS / Linux:

```sh
cp .dev.vars.example .dev.vars
```

最低限、次をローカル専用値で設定します。

```env
AUTH_SECRET="32文字以上のランダム値"
AUTH_DISCORD_ID="Discord OAuth Client ID"
AUTH_DISCORD_SECRET="Discord OAuth Client Secret"
AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_SITE_URL="http://localhost:3000"
NEXT_PUBLIC_SITE_NAME="FlameNode"
SPREADSHEET_IMPORT_PREVIEW_SECRET="AUTH_SECRETとは別の32文字以上の値"
```

- `AUTH_URL`と`NEXT_PUBLIC_SITE_URL`は同じ正式originにする。
- `AUTH_TRUST_HOST`はローカル開発時だけ明示的に`true`にする。productionではHost headerへの暗黙fallbackを使わない。
- secret、token、Cloudflare IDをGitへ追加しない。

## 4. ローカルD1

```sh
npm run db:local-apply
```

このコマンドは`migrations/`直下のactive migrationを番号順にローカルD1へ適用します。起動時ALTER/CREATE/backfillは行わず、schema不一致はfail-closedで扱います。

状態確認例:

```sh
npx wrangler d1 execute flamenode_db --local --command "PRAGMA foreign_keys;"
npx wrangler d1 execute flamenode_db --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

管理者権限が必要なローカル確認では、ログイン後に次を使用します。

```sh
npm run grant-admin
```

実データを想定したdemo seedは必須ではありません。テストfixtureは各test/scriptが一時DBへ冪等に作成し、本番・Remote D1へ流用しません。

## 5. 通常開発

```sh
npm run dev
```

`http://localhost:3000/`を開きます。Discord Developer Portalには次をローカル用redirectとして登録します。

```text
http://localhost:3000/api/auth/callback/discord
```

ローカル用Discord applicationを本番用と分離してください。

## 6. OpenNext / Cloudflare Workersローカル確認

OpenNext成果物はcommit SHAを埋め込むため、build時は現在のGit HEADを明示します。`preview`は同じHEADを自動取得します。

Windows PowerShell:

```powershell
$env:WORKERS_CI_COMMIT_SHA = (git rev-parse HEAD).Trim()
npm run cf:build
npm run preview
Remove-Item Env:WORKERS_CI_COMMIT_SHA
```

macOS / Linux:

```sh
export WORKERS_CI_COMMIT_SHA="$(git rev-parse HEAD)"
npm run cf:build
npm run preview
unset WORKERS_CI_COMMIT_SHA
```

`cf:build`はNext.jsをOpenNextで1回だけbuildし、`.open-next/worker.js`、Static Assets、commit manifest、機密値混入を検査します。`preview`は同じ成果物を`wrangler dev`でD1/R2/KVのローカルbindingとともに`http://localhost:3000`で起動し、公開health用commit SHAとローカルpreview専用のloopback許可を自動注入します。この許可はproduction環境・生成configでは拒否されます。

別ポートを使う場合は`FLAMENODE_PREVIEW_PORT`、`.dev.vars`の`AUTH_URL`と`NEXT_PUBLIC_SITE_URL`、Discord redirectの3箇所を同じportへ変更します。

## 7. 必須検査

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:workers
npm run test:cloudflare-ci
npm run test:integration
npm run verify:fast
npm run verify:full
npm run cf:build
npm run check:open-next-output
npm run check:cloudflare-template
npm run check:db-schema
npm run check:db-legacy
npm run check:event-owners
npm run check:ui-acceptance
npm run check:public-api-leaks
npm run check:docs
npm run check:db-history
npm run check:project-docs
```

`check:cloudflare-config`はproductionの実URL・resource ID・commitを要求するため、それらを持たないローカル環境ではfail-closedになるのが正しい挙動です。通常の構造確認は`check:cloudflare-template`と`test:cloudflare-ci`を使用し、fixture modeや追跡対象設定への実ID書込みは行いません。

## 8. ローカル運用確認

operation modeはローカルD1だけで変更します。

```sh
npx wrangler d1 execute flamenode_db --local --command "UPDATE system_settings SET operation_mode='economy' WHERE id='default';"
npx wrangler d1 execute flamenode_db --local --command "UPDATE system_settings SET operation_mode='normal' WHERE id='default';"
```

管理スプレッドシートはdry runと署名tokenを経由し、直接DBへ未検証値を書き込みません。

## 9. トラブルシューティング

### schema不一致

```sh
npm run db:local-apply
npm run check:db-schema
npm run check:db-legacy
```

active migrationを修正せず、新しいmigrationが必要か確認します。

### OpenNext成果物が不完全

```powershell
npm run clean:next
npm ci
$env:WORKERS_CI_COMMIT_SHA = (git rev-parse HEAD).Trim()
npm run cf:build
npm run check:open-next-output
Remove-Item Env:WORKERS_CI_COMMIT_SHA
```

macOS / Linuxでは同じSHAを`export WORKERS_CI_COMMIT_SHA="$(git rev-parse HEAD)"`で設定します。古い`.open-next`成果物が疑われる場合は、build processが停止していることを確認してから生成物を削除し、再buildします。

### OAuth callback不一致

`AUTH_URL`、`NEXT_PUBLIC_SITE_URL`、Discord redirectのscheme・host・portを完全一致させます。`trustHost`やlocalhost fallbackで回避しません。

### D1/R2/KV bindingがない

`wrangler.toml`の論理binding名を変更せず、`npm run check:cloudflare-template`で確認します。production IDをローカルファイルへ直接書き込まないでください。
