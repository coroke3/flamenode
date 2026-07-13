# FlameNode デプロイ手順書

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `2fd430c`
> Source of truth: `.github/workflows/deploy-cloudflare.yml`, `package.json`, `wrangler.toml`, `workers/*/wrangler.toml`

FlameNodeの本番デプロイ正本は **GitHub Actionsの`.github/workflows/deploy-cloudflare.yml`だけ**です。Cloudflare PagesのGit連携による自動deployは無効にし、ローカル端末や別workflowから同じproductionを二重deployしません。

## 1. 固定構成

| 領域 | 構成 |
| --- | --- |
| Web | Cloudflare Pages + `@cloudflare/next-on-pages` |
| Database | Cloudflare D1 |
| Object storage | Cloudflare R2 |
| Cache / lightweight state | Cloudflare KV |
| Cron Worker | `flamenode-fast-jobs` |
| Cron Worker | `flamenode-content-jobs` |
| Cron Worker | `flamenode-sync-jobs` |

OpenNext、Workers Sites、追加常駐Workerへ移行しません。旧Worker directoryは共有・import moduleとしてのみ使用し、直接deployしません。

## 2. 実在する運用script

```sh
npm run cf:bootstrap
npm run cf:sync-ids
npm run check:cloudflare-template
npm run check:cloudflare-config
npm run cf:preflight
npm run pages:build
npm run pages:deploy
npm run workers:deploy
```

- `pages:build`はリポジトリのwrapperを経由する。
- `pages:deploy`と`workers:deploy`は手動緊急確認用で、通常production releaseには使わない。
- `db:generate`は使用しない。DB変更はschema、追加migration、change log、詳細履歴を同時更新する。

## 3. GitHub Environment `production`

### Secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CF_IDS_JSON`
- `AUTH_SECRET`
- `AUTH_DISCORD_ID`
- `AUTH_DISCORD_SECRET`

YouTubeや内部Worker endpointを使用する場合は、実装が参照するproduction secretも同EnvironmentまたはCloudflare側へ設定します。値をworkflow log、artifact、Markdownへ記載しません。

### Variables

- `NEXT_PUBLIC_SITE_URL`
- `FAST_JOBS_URL`
- `CONTENT_JOBS_URL`
- `SYNC_JOBS_URL`

すべてHTTPSの正式origin / endpointを設定します。

### `CF_IDS_JSON`

production resource IDの唯一のGitHub側正本です。例のキー名だけを示します。

```json
{
  "d1_database_id": "<D1 UUID>",
  "d1_database_name": "flamenode_db",
  "kv_namespace_id": "<KV ID>",
  "kv_preview_id": "<Preview KV ID>",
  "r2_bucket_name": "<R2 bucket name>",
  "pages_project_name": "flamenode"
}
```

- binding構造はwrangler群が正本。
- local IDはGit管理外の`cloudflare/ids.json`。
- productionでは`CF_IDS_JSON`を優先し、競合・placeholder・不足をfail-closedにする。

## 4. 初回リソース準備

Cloudflare resource作成は運用者が明示的に行います。

```sh
npm ci
npm run cf:bootstrap
```

生成されたIDをGitへcommitせず、`production` Environmentの`CF_IDS_JSON`へ登録します。PreviewとProductionのD1/R2/KV・OAuth設定を分離してください。

## 5. release前検証

GitHub Actionsのrelease gateは次を実行し、1件でも失敗したらdeployへ進みません。

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:workers
npm run test:cloudflare-ci
npm run test:integration
npm run build
npm run pages:build
npm run check:pages-output
npm run check:cloudflare-template
npm run check:db-schema
npm run check:db-legacy
npm run check:event-owners
npm run check:ui-acceptance
npm run check:docs
npm run check:db-history
npm run check:project-docs
```

`check:cloudflare-config`はproduction secretsを受け取ったjobで実行し、secret不足・placeholder・形式不正を成功扱いにしません。

## 6. デプロイ実行

GitHubのActions画面から **Deploy Cloudflare** を`workflow_dispatch`で実行します。

通常更新:

- `deploy_pages=true`
- `deploy_workers=true`
- `bootstrap_database=false`
- `apply_pending_migrations=false`、または承認済みpending migrationがある場合だけ`true`

空のproduction D1を初期化する初回だけ:

- `bootstrap_database=true`
- `apply_pending_migrations=false`

`bootstrap_database`と`apply_pending_migrations`を同時に有効化できません。

workflowは同じcommitに対して次の順で進みます。

1. release gate
2. production設定検査
3. Pages artifact build・検査・固定
4. 明示時だけD1 bootstrapまたはpending migration
5. 固定artifactをPagesへdeploy
6. Cron Worker 3本を固定順でdeploy
7. production smoke test

concurrencyにより同時production deployを禁止します。migration、Pages、Workersの途中失敗時は後続jobへ進みません。

## 7. DB migration

- Remote D1へ自動でschemaを推測・補修しない。
- active migrationのSQL本文を変更しない。
- backup、change log、rollback、検証を確認してから`apply_pending_migrations=true`を選択する。
- 空DBの初期構築前に`check-d1-bootstrap-state`がemptyを確認する。
- 既存DBへの適用前にbaseline markerを確認する。

詳細は [`docs/operations/migrations.md`](./docs/operations/migrations.md) を参照してください。

## 8. smoke test

release後にworkflowが次を有限回で確認します。

- top pageが200または想定redirect
- `/api/health`
- `_next/static` asset
- Auth callbackが500ではない
- 3 Workerの`/health`
- 副作用endpointへの未認証アクセス拒否
- PagesとWorkerの`BUILD_COMMIT_SHA`一致

health responseへsecret、Cloudflare ID、DB内容、user情報、詳細exceptionを含めません。

## 9. rollback

### Pages

Cloudflare Pagesの直前の成功deploymentへ戻します。原因commitを修正せず同じ壊れたartifactを再deployしません。

### Workers

直前の成功commitをcheckoutした明示releaseで3本を同じ世代へ戻します。1本だけ異なる世代に固定しません。

### D1

migrationが安全に逆操作できない場合は、事前backupから運用者が復旧します。コードのrollbackだけで旧schema互換を復活させません。

## 10. 障害確認

1. GitHub Actionsの失敗jobと安全なerror summaryを確認する。
2. `check:cloudflare-config`で不足した**変数名だけ**を確認する。
3. Pages / Worker healthとcommit SHAを比較する。
4. D1 schema version、owner不在、stale lease、queue/outboxをintegrity checkで確認する。
5. secret、token、cookie、Webhook URLをissueやlogへ貼らない。

## 11. Cloudflare上限

無料枠の数値は文書へ固定しません。2026-07-13時点の設計はbounded LIMIT、cursor、lease、retry上限、差分R2生成、3 Cron Workerを前提としています。release前にCloudflare公式の最新Pages、Workers、D1、KV、R2制限を再確認してください。
