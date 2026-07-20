# FlameNode ローカル動作手順書

> Status: Active
> Last verified: 2026-07-20
> Verified against commit: `8de170c`
> Source of truth: `package.json`, `.dev.vars.example`, `migrations/` active path, `wrangler.toml`, `docs/operations/migrations.md`

この文書は個人PCの実施済み状態を前提にせず、空の作業環境からFlameNodeを再現する手順だけを扱います。本番操作は [`DEPLOY.md`](./DEPLOY.md) を参照してください。

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
- `AUTH_TRUST_HOST`は設定しない。Host headerへの暗黙fallbackを使わない。
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

## 6. Cloudflare Pages互換確認

```sh
npm run pages:build
npm run check:pages-output
npm run pages:dev
```

`pages:build`はリポジトリのwrapperを経由します。生の`next-on-pages` CLIを直接呼びません。`pages:dev`は`.vercel/output/static`をD1/R2/KVのローカルbindingで起動します。

Pages devのoriginを`http://localhost:8788`にする場合は、`.dev.vars`の`AUTH_URL`と`NEXT_PUBLIC_SITE_URL`を同じoriginへ変更し、Discord redirectへ次を追加します。

```text
http://localhost:8788/api/auth/callback/discord
```

## 7. 必須検査

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:workers
npm run test:integration
npm run build
npm run pages:build
npm run check:pages-output
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

`check:cloudflare-config`のproduction modeは本番secretがないローカル環境では失敗するのが正しい挙動です。構造確認は次のfixture modeを使います。

```sh
CLOUDFLARE_CONFIG_MODE=fixture npm run check:cloudflare-config
```

PowerShell:

```powershell
$env:CLOUDFLARE_CONFIG_MODE="fixture"
npm run check:cloudflare-config
Remove-Item Env:CLOUDFLARE_CONFIG_MODE
```

## 8. ローカル運用確認

operation modeはローカルD1だけで変更します。

```sh
npx wrangler d1 execute flamenode_db --local --command "UPDATE system_settings SET operation_mode='economy' WHERE id='default';"
npx wrangler d1 execute flamenode_db --local --command "UPDATE system_settings SET operation_mode='normal' WHERE id='default';"
```

管理spreadsheetはdry runと署名tokenを経由し、直接DBへ未検証値を書き込みません。旧形式データが必要な場合は常設画面を追加せず、レビュー可能な一度限りのmigrationで正本へ変換します。

## 9. トラブルシューティング

### schema不一致

```sh
npm run db:local-apply
npm run check:db-schema
npm run check:db-legacy
```

active migrationを修正せず、新しいmigrationが必要か確認します。

### Pages成果物が不完全

```sh
npm run clean:next
npm ci
npm run pages:build
npm run check:pages-output
```

### OAuth callback不一致

`AUTH_URL`、`NEXT_PUBLIC_SITE_URL`、Discord redirectのscheme・host・portを完全一致させます。`trustHost`やlocalhost fallbackで回避しません。

### D1/R2/KV bindingがない

`wrangler.toml`の論理binding名を変更せず、`npm run check:cloudflare-template`で確認します。production IDをローカルファイルへ直接書き込まないでください。
