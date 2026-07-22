# Incident Response

> Status: Active
> Last verified: 2026-07-21
> Verified against commit: `47e6cee`
> Source of truth: `scripts/cloudflare-*.mjs`, `src/lib/cloudflare.ts`, `src/lib/health/`, `wrangler.toml`, `workers/*/wrangler.toml`

## 原則

binding、remote secret名、commit SHA、schema versionが一致しない場合はfail-closedで停止する。production障害時も検査を無効化せず、最初に失敗した境界を特定する。secret、token、実resource ID、cookie、Webhook URL、OAuth情報、ユーザーデータをlog、Issue、監査snapshotへ貼り付けない。

## Build / deployの切り分け

| 失敗stage | 最初に確認するもの |
| --- | --- |
| dependency install | Node 22、`SKIP_DEPENDENCY_INSTALL=true`、lockfile、`npm ci`の最初のerror |
| `verify:cloud` | Cloudflare CI契約、template検査の最初の失敗（Workers Builds） |
| `verify:fast` | typecheck、lint、critical test、Worker test、Cloudflare契約、公開API漏洩検査の最初の失敗（ローカル） |
| OpenNext build | Next.js compile、runtime非互換import、request context、`.open-next/worker.js`生成 |
| artifact検査 | Static Assets、commit manifest、旧形式artifact、secret/resource値混入 |
| production環境検査 | 不足した変数名、URL形式、40桁SHAとGit HEAD、placeholder ID |
| remote secret検査 | 対象Workerと不足したsecret名。値は確認・出力しない |
| D1 preflight | 接続、schema version、`src/lib/db/schema.ts`がexportする全正本table、`d1_migrations`。自動migrationしない |
| Worker deploy | Web→fast→content→syncのどこまで同じcommitで成功したか |
| smoke | top、asset、Auth、health、deep health、DTO、404/methodの最初の失敗 |

途中deploy失敗は4 Workerを跨ぐtransactionではない。すでに更新されたWorkerがある場合、後続を手動で進めず、[`../../DEPLOY.md`](../../DEPLOY.md)のrollback手順で4 Workerを同じ既知の正常commitへ戻してsmokeする。

## Runtime一次確認

1. `/api/health`が`flamenode-web`、`cloudflare-worker`、期待commitだけを返すか確認する。
2. Cron 3本の`/health`が同じcommitを返すか確認する。
3. 認証済みdeep healthでD1/KV/R2/schemaのread-only結果を確認する。
4. Cloudflare bindingsとRuntime Secretの**名前**をwrangler契約へ照合する。
5. Cloudflare Logsで最初の安全なerror codeとInvocation Statusを確認する。

公開healthやerror responseへDB内容、例外stack、binding実値を追加しない。deep healthは`WORKER_ADMIN_TOKEN`なしで通さず、書込み疎通を行わない。

## よくある症状

### Auth callbackが5xx / redirect loop

`FLAMENODE_WEB_URL`、`NEXT_PUBLIC_SITE_URL`、`AUTH_URL`、custom domain、Discord callbackのscheme・host・portを完全一致させる。`AUTH_SECRET`と`AUTH_DISCORD_SECRET`のremote secret名を確認する。Host headerの無条件信頼やlocalhost fallbackで回避しない。

### D1 query / authが503

deep healthとdeploy時read-only preflightを確認する。binding `DB`、schema version、必須migrationの不一致を修正し、必要ならbackup・レビュー後に運用者が手動migrationを行う。runtime DDL、旧列fallback、二重書込みを追加しない。

### Static Assetsが404 / SSRが起動する

OpenNext artifactの`assets`、wranglerの`ASSETS`、`run_worker_first = false`、同一originの`_next/static` URLを確認する。全assetを動的Route Handlerへ迂回させない。

### Worker間でcommitが異なる

以降のdeployとtraffic切替を停止する。部分更新された全Workerを同じ正常commitへrollbackするか、同じ`main` commitのWorkers Buildを再実行する。`BUILD_COMMIT_SHA=unknown`で継続しない。

### `exceededCpu` / Error 1102

Worker別CPU時間とInvocation Statusを確認する。Cronはbatch上限を下げ、不要な全件走査、重複処理、過剰JSON parseを確認する。WebのAuth/SSRはWorkers Freeの10msを継続的に超える可能性があるため、実測超過が続く場合は安定保証せずPaidへ移行する。公式正本: https://developers.cloudflare.com/workers/platform/limits/

### D1無料枠 / rows read・written増加

Cloudflare DashboardのRow Metricsを確認する。無制限SELECT、N+1、index未使用、差分なしUPDATE、過大cleanupを特定し、処理上限を一時的に下げる。D1料金・枠: https://developers.cloudflare.com/d1/platform/pricing/

### Cron重複 / queue滞留

`worker_leases`、lease token、期限、retry、dead-letter、前回commitを確認する。KVを強整合lockや二重送信防止の唯一正本にしない。poison itemを無限retryしない。

## 連絡・記録

incident記録には時刻、対象service、期待commit/実commit、最初の失敗stage、安全なerror code、影響範囲、rollback先だけを残す。Secret値や実resource IDは記録しない。復旧後は4 Workerのcommit一致、production smoke、Cloudflare Metricsを再確認する。
