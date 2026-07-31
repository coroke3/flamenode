# FlameNode デプロイ手順書

> Status: Active
> Last verified: 2026-07-25
> Verified against commit: `dc46eefa`
> Source of truth: `package.json`, `scripts/cloudflare-*.mjs`, `wrangler.toml`, `workers/*/wrangler.toml`

**AI:** 通常は §1 固定構成と §3–4（Build / Runtime Variables）だけ。初回準備チェックリストは [`docs/operations/deploy-setup-report.md`](./docs/operations/deploy-setup-report.md)。実 Cloudflare / Remote D1 / production secret は明示依頼時のみ。

FlameNodeのproductionデプロイ正本はCloudflare Workers Buildsだけです。`main`への1回のpushから1回だけBuildし、同じOpenNext成果物とcommit SHAでWeb Worker、Cron Worker 3本、smoke testまで進めます。GitHub Actions、ローカル端末、Worker別Git連携を日常的なproduction deploy経路にしません。

## 1. 固定構成

| 領域 | 構成 |
| --- | --- |
| Web | `flamenode-web` + `@opennextjs/cloudflare` + Workers Static Assets |
| Database | Cloudflare D1 `flamenode_db` |
| Object storage | Cloudflare R2 |
| Cache / lightweight state | Cloudflare KV |
| Background | `flamenode-fast-jobs` / `flamenode-content-jobs` / `flamenode-sync-jobs` |
| CI/CD | `flamenode-web`に接続したCloudflare Workers Builds 1件だけ |

productionの固定順は次です。

```text
main push
  -> npm ci（1回）
  -> verify:cloud（deploy契約検査のみ）
  -> OpenNext build（1回）
  -> flamenode-web
  -> flamenode-fast-jobs
  -> flamenode-content-jobs
  -> flamenode-sync-jobs
  -> production smoke
```

Static Assetsは`run_worker_first = false`とし、静的ファイルを通常のWorker invocationより先に配信します。OpenNext buildをDeploy commandで再実行しません。

## 2. Cloudflare Dashboard設定チェックリスト

1. Workers BuildsのGit連携は`flamenode-web`だけへ設定する。
2. Repositoryは`coroke3/flamenode`を選ぶ。
3. Production branchは`main`にする。
4. Non-production / Preview branch buildsを無効にする。
5. Pull Request buildsを無効にする。
6. Root directoryはリポジトリルート（Dashboardでは空欄）にする。
7. Build Variable `NODE_VERSION=22`を設定する。
8. Build commandを`npm ci --no-audit --no-fund && npm run cf:cloud-build`にする。`npm run build`はOpenNext内部でも使用される通常のNext.js build専用であり、Cloudflare buildへフォールバックさせない。Deploy commandも必ず正本に設定すること。
9. Deploy commandを`npm run cf:deploy-production && npm run cf:smoke-production`にする。
10. Build Variablesは「3. Build環境」記載の名前だけを登録する。
11. Runtime Variablesは「4. Runtime設定」とwrangler群へ一致させる。
12. Build SecretsとRuntime Secretsを分離し、通常のRuntime Secret値をBuildへ複製しない。deep-health smoke用`WORKER_ADMIN_TOKEN`だけは後述の明示例外とする。
13. D1 bindingは全4 Workerで既存の論理名へ一致させる。
14. R2 bindingはWebとcontent-jobsで既存の論理名へ一致させる。
15. KV bindingは全4 Workerで既存の論理名へ一致させる。
16. Cron Triggerはfast、content、syncのRecovery Cron 4式だけにする（アカウント合計がCloudflare上限5件以内であることを確認する。リポジトリ外の既存Triggerは削除しない）。
17. Queue 6本（wake 3 + DLQ 3）を作成し、producer/consumer bindingをwrangler群どおり接続する。
18. Queue feature flagは全Workerでデフォルト`"0"`とし、段階的に有効化する。
19. 旧Pages Git Integrationを停止し、新しいBuildと二重起動させない。
20. GitHub Actionsのpush、pull request、schedule、自動deployが存在しないことを確認する。
21. 初回は4 Worker名、resource、Queue、Runtime Secret、D1 schemaを準備してから`main` Buildを実行する。
22. 最初は各`workers.dev` URLで4 Workerとsmokeを確認する。
23. 検証後に`flamenode-web`へカスタムドメインを追加し、Auth originとDiscord callbackを同時更新する。
24. カスタムドメインの疎通後に旧Pagesからトラフィックを切り替える。
25. Deploy commandのproduction smokeが全項目成功したことを確認する。
26. 旧Pages projectは削除条件をすべて満たすまで移行時rollback先としてだけ保持する。
27. rollback時は4 Workerを同じ既知の正常commitへ戻し、再度smokeする。
28. D1 migrationはbackup・レビュー後に運用者が手動適用し、自動deployへ組み込まない。
29. 障害時はBuild stage、4 Workerのhealth/commit、binding、Queue binding、remote secret名、D1 schema、Cloudflare Metricsを順に確認する。

## 3. Workers Builds設定

### Build settings

| 設定 | 値 |
| --- | --- |
| Worker | `flamenode-web` |
| Repository | `coroke3/flamenode` |
| Production branch | `main` |
| Preview / non-production branches | Disabled |
| Pull Request builds | Disabled |
| Root directory | 空欄（repository root） |
| Build command | `npm ci --no-audit --no-fund && npm run cf:cloud-build` |
| Deploy command | `npm run cf:deploy-production && npm run cf:smoke-production` |

Cloudflare側の自動dependency installを止め、`npm ci`を1回に固定します。

| Build Variable | 値 / 用途 |
| --- | --- |
| `NODE_VERSION` | `22` |
| `SKIP_DEPENDENCY_INSTALL` | `true` |
| `CLOUDFLARE_ACCOUNT_ID` | production account ID |
| `CF_D1_DATABASE_ID` | production D1 UUID |
| `CF_KV_NAMESPACE_ID` | production KV namespace ID |
| `CF_R2_BUCKET_NAME` | production R2 bucket name |
| `FLAMENODE_WEB_URL` | WebのHTTPS origin |
| `FAST_JOBS_URL` | fast-jobsのHTTPS origin |
| `CONTENT_JOBS_URL` | content-jobsのHTTPS origin |
| `SYNC_JOBS_URL` | sync-jobsのHTTPS origin |
| `NEXT_PUBLIC_SITE_URL` | `FLAMENODE_WEB_URL`と同じorigin |
| `AUTH_URL` | `FLAMENODE_WEB_URL`と同じorigin |
| `AUTH_DISCORD_ID` | production Discord OAuth Client ID |
| `QUEUE_DISPATCH_ENABLED` | Queue wake 有効時は `"1"`（未設定時は template `"0"`） |
| `QUEUE_CONTINUATION_ENABLED` | 継続 wake 有効時は `"1"` |
| `QUEUE_YOUTUBE_SYNC_ENABLED` | YouTube sync wake 有効時は `"1"` |

`WORKERS_CI_COMMIT_SHA`はWorkers Buildsが自動提供する40桁SHAを使用し、Dashboardで上書きしません。Git HEADと一致しない、欠落する、形式が不正な場合はproduction deployを停止し、`unknown`で継続しません。

production resource IDはGit、Markdownの実値、artifact、logへ保存しません。Build内で検証後、`.cloudflare/generated/`のGit管理外一時configへ注入し、追跡対象wrangler templateはplaceholderのまま維持します。

### Build Secrets

- `CLOUDFLARE_API_TOKEN`
- `WORKER_ADMIN_TOKEN`

`CLOUDFLARE_API_TOKEN`は4 Workerのdeploy、remote secret名の一覧取得、Remote D1のread-only検査に必要な最小権限だけを与えます。権限不足は迂回せずBuild失敗とします。

`WORKER_ADMIN_TOKEN`は、Deploy commandから保護された`/api/health/deep`を呼びD1/KV/R2/schemaをread-only確認するための唯一の例外です。同値を`flamenode-web`と`flamenode-content-jobs`のRuntime Secretにも登録します。値はartifact scanとlog redactionの対象で、出力・永続化しません。その他のRuntime Secret値はBuild環境へ渡しません。

Workers Buildsのsystem変数、Build/Deploy分離、branch設定は次を正本とします。

- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-image/

## 4. Runtime Variables / Secrets / bindings

### Runtime Variables

| Worker | Variables |
| --- | --- |
| `flamenode-web` | `NEXT_PUBLIC_SITE_URL`、`AUTH_URL`、`AUTH_DISCORD_ID`、公開site metadata、`BUILD_COMMIT_SHA`、`QUEUE_DISPATCH_ENABLED`、`QUEUE_CONTINUATION_ENABLED`、`QUEUE_YOUTUBE_SYNC_ENABLED` |
| `flamenode-fast-jobs` | `BUILD_COMMIT_SHA`、`QUEUE_DISPATCH_ENABLED`、`QUEUE_CONTINUATION_ENABLED`、`QUEUE_YOUTUBE_SYNC_ENABLED` |
| `flamenode-content-jobs` | `BUILD_COMMIT_SHA`、`QUEUE_DISPATCH_ENABLED`、`QUEUE_CONTINUATION_ENABLED`、`QUEUE_YOUTUBE_SYNC_ENABLED` |
| `flamenode-sync-jobs` | `YOUTUBE_DAILY_QUOTA_LIMIT`、`BUILD_COMMIT_SHA`、`QUEUE_DISPATCH_ENABLED`、`QUEUE_CONTINUATION_ENABLED`、`QUEUE_YOUTUBE_SYNC_ENABLED` |

Queue feature flagはwrangler templateどおり**デフォルト`"0"`**（無効）とする。本番で有効化する正本は次の2段。

1. **即時**: 各 Worker の Runtime Variables で `QUEUE_DISPATCH_ENABLED` / `QUEUE_CONTINUATION_ENABLED` / `QUEUE_YOUTUBE_SYNC_ENABLED` を `"1"` にする
2. **永続**: Workers Builds の Build Variables にも同名で `"1"` を登録する。`cf:deploy-production` が生成 config へ注入し、次回 `main` deploy でも `"0"` に戻さない

ロールバックは Runtime と Build Variables の双方を `"0"` へ戻す（Queue リソースと binding は維持し、送信・消費だけ止める）。正本名は `src/lib/queues/wakeBudget.ts` の `QUEUE_FEATURE_FLAG_NAMES`。

公開site metadataとYouTube quota既定値はwrangler templateを正本とし、production origin、OAuth Client ID、commitは検証済み一時configへ注入します。Dashboardで同名値を別正本として手動driftさせません。

### Runtime Secrets

| Worker | 必須secret名 |
| --- | --- |
| `flamenode-web` | `AUTH_SECRET`、`AUTH_DISCORD_SECRET`、`SPREADSHEET_IMPORT_PREVIEW_SECRET`、`WORKER_ADMIN_TOKEN` |
| `flamenode-fast-jobs` | `DISCORD_BOT_TOKEN`または`DISCORD_WEBHOOK_URL`の少なくとも一方 |
| `flamenode-content-jobs` | `WORKER_ADMIN_TOKEN` |
| `flamenode-sync-jobs` | `YOUTUBE_API_KEY`、`YOUTUBE_OAUTH_CLIENT_ID`、`YOUTUBE_OAUTH_CLIENT_SECRET`、`YOUTUBE_OAUTH_REFRESH_TOKEN` |

deploy preflightはremoteに登録されたsecretの**名前だけ**を検査します。Build環境からRuntime Secret値を再投入・比較しません。不足時は対象Worker名と不足名だけを表示して停止します。secret値、token、Webhook URL、cookie、ユーザーデータをlogへ出しません。続けて Cron Worker 3本（`fast-jobs` / `content-jobs` / `sync-jobs`）へ `wrangler deploy --dry-run` を実行し、アップロードサイズが 2.9MiB 以上ならデプロイを停止、2.7MiB 以上なら警告します。

### Bindings

| Worker | binding |
| --- | --- |
| `flamenode-web` | D1 `DB`、R2 `BUCKET`、R2 incremental cache `NEXT_INC_CACHE_R2_BUCKET`、KV `KV`、Assets `ASSETS`、service `WORKER_SELF_REFERENCE`、Queue producer `NOTIFICATION_WAKE_QUEUE`、`STATIC_REBUILD_WAKE_QUEUE`、`YOUTUBE_SYNC_WAKE_QUEUE` |
| `flamenode-fast-jobs` | D1 `DB`、KV `KV`、Queue producer/consumer `NOTIFICATION_WAKE_QUEUE` |
| `flamenode-content-jobs` | D1 `DB`、R2 `R2`、KV `KV`、Queue producer/consumer `STATIC_REBUILD_WAKE_QUEUE` |
| `flamenode-sync-jobs` | D1 `DB`、KV `KV`、Queue producer/consumer `YOUTUBE_SYNC_WAKE_QUEUE` |

論理binding名はコードとwrangler群の契約です。production IDやbucket名だけをBuild Variablesから一時configへ注入します。Queue binding欠落は`npm run check:cloudflare-template`とproduction config検証で**fail-closed**とし、deployを停止します。consumer設定の正本は`workers/*/wrangler.toml`、詳細は[`docs/operations/workers.md`](./docs/operations/workers.md)を参照してください。

### Cron Triggers（Recovery）

通常運用はQueue駆動を優先し、Cronはwakeが届かなかった場合の安全網（Recovery）です。

| Worker | Cron |
| --- | --- |
| `flamenode-fast-jobs` | `0 * * * *` |
| `flamenode-content-jobs` | `15 * * * *` |
| `flamenode-sync-jobs` | `7 * * * *`、`52 * * * *` |

Cron WorkerへGit連携を追加せず、上記4式以外のTriggerを増やしません。CloudflareアカウントのCron Trigger合計が上限5件以内であることをDashboardで確認します（リポジトリ外の既存Triggerは削除しません）。

## 5. 初回resource / Worker準備

resource作成は運用者が明示した場合だけ行います。

```sh
npm ci --no-audit --no-fund
npm run cf:bootstrap -- --confirm-create
```

`cf:bootstrap`はD1、R2、KVだけを作成し、IDを表示・保存せず、migration、Worker deploy、secret更新を行いません。Cloudflare Dashboardで実IDを確認し、Build Variablesへ直接登録します。

Queue 6本（wake 3 + DLQ 3）は初回のみ手動作成します。binding名・consumer設定の正本はtracked wrangler群です。

```sh
npx wrangler queues create flamenode-notification-wake
npx wrangler queues create flamenode-notification-dlq
npx wrangler queues create flamenode-static-rebuild-wake
npx wrangler queues create flamenode-static-rebuild-dlq
npx wrangler queues create flamenode-youtube-sync-wake
npx wrangler queues create flamenode-youtube-sync-dlq
```

詳細・free tier予算は[`docs/operations/workers.md`](./docs/operations/workers.md)を参照してください。

初回Build前にDashboardで次を行います。

1. exact nameの4 Workerを用意する。Cron WorkerへGitを接続しない。
2. Queue 6本を作成し、wrangler群どおりproducer/consumer bindingを接続する。
3. 各WorkerのRuntime Secretを上表どおり登録する。Queue feature flagは全Workerで`"0"`のまま開始する。
4. D1を手動初期化し、必要なactive migrationを適用する。
5. 4 Workerの`workers.dev` URLをBuild Variablesへ登録する。
6. `flamenode-web`だけをGitへ接続し、Build/Deploy commandを保存する。
7. `main` Buildを実行し、固定順deployとsmokeを確認する。

secret preflightまたはD1 preflightが失敗した場合は不足を直し、同じBuild設定で再試行します。検査をskipする初回専用フラグは設けません。

## 6. D1 migrationとpreflight

production deployはRemote D1へSELECTだけを実行し、次を確認します。

- D1へ接続できる。
- `flamenode_schema_meta`のversionがコード要求値と一致する。
- `src/lib/db/schema.ts`がexportする全正本テーブルと`d1_migrations`が存在する。
- `migrations/`のactive migrationに明らかな未適用がない。

不一致時はWebを含む全deployを開始しません。production deploy、runtime、Codexがmigrationを自動適用することは禁止です。

手動適用はbackup、対象SQL、change log、rollback方針をレビューした運用者だけが、production値を安全なoperator shellへ設定して実行します。

```sh
export WORKERS_CI_COMMIT_SHA="$(git rev-parse HEAD)"
node scripts/cloudflare-verify-environment.mjs
npx wrangler d1 migrations apply flamenode_db --remote --config .cloudflare/generated/web.toml
```

PowerShellでは`$env:WORKERS_CI_COMMIT_SHA = (git rev-parse HEAD).Trim()`を使用します。実IDやtokenをコマンド行、shell history、Issueへ貼りません。適用後は停止したWorkers Buildを再試行し、read-only preflightからやり直します。詳細は[`docs/operations/migrations.md`](./docs/operations/migrations.md)を参照してください。

## 7. Build・deploy・smoke

`npm run cf:cloud-build`は`verify:cloud`（`test:cloudflare-ci`と`check:cloudflare-template`のみ）の後、OpenNext buildを1回実行し、Worker entrypoint、Static Assets、commit manifest、旧形式artifact、機密値混入を検査します。typecheck、lint、critical/Worker unit testはWorkers Buildsでは走らせず、ローカルの`verify:fast` / `cf:preflight`で行う。各stepは開始、終了、所要時間だけを安全にlogへ出します。

Deploy commandは次を行います。

1. Build Variables、URL、実resource ID、commit SHAをfail-closedで検査する。
2. production一時configを生成・検査する。
3. remote secret名を検査する。
4. Remote D1をread-only検査する。
5. Web→fast→content→syncを順次deployする。
6. 全deploy成功後だけproduction smokeを行う。

途中失敗時は後続Workerとsmokeへ進みません。4 Workerを跨ぐ単一transactionではないため、すでにdeploy済みのWorkerがある場合は「10. rollback」に従い同じ正常commitへ戻します。

smokeは有限retryとtimeoutを持ち、URL未設定をskipしません。deploy直後はCloudflare edgeが一時的に直前の正常commitを返す場合があるため、HTTP 200でもhealthのcommitが一致するまで最大30回・1秒間隔で待機し、収束しない場合だけ失敗します。確認対象は次です。

- 正式トップ、`/list`、同一originの`_next/static` asset
- 旧形式インポートRoute Moduleの未認証拒否（データ変更なし）
- 公開`/api/health`のservice、runtime、commit
- Discord Auth callbackが404/5xxではない
- Cron Worker 3本の`/health`とcommit
- content-jobs副作用endpointの未認証拒否
- 保護されたdeep healthのD1/KV/R2/schema read-only結果
- 主要公開APIの明示DTOと内部key非露出
- 404と不正method

公開healthとerror responseへsecret、resource ID、DB内容、ユーザーデータ、詳細exceptionを含めません。

## 8. `workers.dev`からカスタムドメインへ

初回は4つの`workers.dev` URLを使い、`FLAMENODE_WEB_URL`、各Cron URL、`NEXT_PUBLIC_SITE_URL`、`AUTH_URL`を一致させてsmokeします。Discord Developer PortalにもWebの検証originに対応するcallbackを登録します。

検証成功後:

1. `flamenode-web`へproduction custom domainを追加する。
2. `FLAMENODE_WEB_URL`、`NEXT_PUBLIC_SITE_URL`、`AUTH_URL`を同じcustom originへ更新する。
3. Discord callbackを`https://<custom-domain>/api/auth/callback/discord`へ更新する。
4. 更新後のWorkers Buildを実行し、custom domainでproduction smokeを成功させる。
5. 旧Pages側のcustom domain / trafficを停止する。

Host header fallbackや`trustHost`の無条件有効化でorigin不一致を回避しません。

## 9. 旧Pages停止・削除条件

Pages Git Integrationと自動deployはWorkers Builds接続前に停止します。旧projectは移行期間中だけrollback候補として保持し、現行コード・Active文書・日常deploy正本にはしません。

次をすべて満たした後だけ削除します。

- custom domainが`flamenode-web`を向く。
- Web/Auth/3 Cron/deep health/公開DTOのproduction smokeが成功する。
- 4 Workerのcommitが一致する。
- Cloudflare Metricsで継続的な5xx、`exceededCpu`、binding errorがない。
- Discord OAuth callbackとSecure Cookieを実ブラウザで確認する。
- rollback先の正常Worker commitとD1 backupを記録する。
- 旧projectを戻す必要がない観測期間を運用者が承認する。

## 10. rollback

### Worker code

Cloudflare Dashboardのversion rollbackまたは正常commitを戻す明示的な`main`更新で、WebとCron 3本を**同じcommit**へ戻します。1本だけ異なる世代に固定しません。rollback後も同じproduction smokeを実行します。

Queue関連の緊急停止は、全Workerの`QUEUE_DISPATCH_ENABLED`・`QUEUE_CONTINUATION_ENABLED`・`QUEUE_YOUTUBE_SYNC_ENABLED`を`"0"`へ戻すだけでよい（Queueリソースとbindingは維持）。flag無効時もRecovery Cron経路はコードに残るため、D1正本の処理は継続する。

移行観測期間中にWorkers全体を利用できない場合だけ、残してある旧Pages deploymentへtrafficを一時的に戻せます。旧project削除後はこの経路を前提にしません。

### D1

code rollbackで旧schema fallback、二重書込み、runtime DDLを復活させません。migrationの逆操作が安全でない場合は事前backupから運用者が復旧します。

## 11. 障害時の確認順

1. Workers Buildの`npm ci`、`verify:cloud`、OpenNext build、artifact検査のどこで失敗したか確認する。
2. production環境検査が示す不足した**変数名、secret名、Worker名だけ**を確認する。
3. Remote D1 preflightのschema version、必須table、migration名を確認する。
4. Web→fast→content→syncのどこまで同じcommitでdeployされたか確認する。
5. 公開health、保護deep health、3 Cron health、smokeの最初の失敗を確認する。
6. Cloudflare DashboardのInvocation Status、`exceededCpu`、D1 rows read/written、R2/KV、Cron履歴を確認する。
7. secret、token、実resource ID、cookie、Webhook URL、OAuth情報をlog、Issue、監査snapshotへ貼らない。

詳細な一次対応は[`docs/operations/incident-response.md`](./docs/operations/incident-response.md)を参照してください。

## 12. 無料枠と公式正本

mainだけ、Preview/PR buildなし、1 push 1 Build、`npm ci` 1回、OpenNext build 1回、固定検査1回とし、Cron Worker別の再install・再test・artifact uploadを行いません。Static Assetsはasset-firstで配信します。Queueはドアベルのみ（業務データ非搭載）とし、Recovery Cronは固定LIMIT、cursor、lease、retry上限、差分R2書込みを維持します。

Workers FreeのHTTP/Cron CPUは各invocation 10msです。Cloudflare公式は認証、SSR、大きなpayload処理が10〜20msになり得ると説明しているため、FlameNodeのAuth/SSRがFreeで常に安定するとは保証しません。実測で`exceededCpu`が継続する場合は、最適化後も無理にFreeへ留めずPaidへ移行します。

変わり得る上限値は次の公式文書を正本とし、この文書へ過度に複製しません。

- Next.js on Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- OpenNext: https://opennext.js.org/cloudflare/get-started
- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- D1 pricing / limits: https://developers.cloudflare.com/d1/platform/pricing/ 、https://developers.cloudflare.com/d1/platform/limits/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
