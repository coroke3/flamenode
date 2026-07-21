# 最新の本番試験結果

> Status: Active
> Last verified: 2026-07-21
> Result: NOT RUN (Cloudflare Workers migration candidate)
> Candidate commit: 未確定
> Source of truth: Cloudflare Workers Buildsのproduction Build結果と`cf:smoke-production`出力

## 結果

Cloudflare Workers + OpenNextへ移行した現行候補について、実Cloudflare deploy、custom domain切替、production smokeはまだ実行していません。成功した本番試験として扱える結果はありません。

次も未実施です。

- `flamenode-web`とCron Worker 3本の実deploy
- 4 Workerのproduction commit一致確認
- `workers.dev`でのproduction smoke
- 保護deep healthによるRemote D1/KV/R2/schemaのread-only確認
- Discord OAuth callbackとSecure Cookieの実ブラウザ確認
- custom domainへのtraffic切替
- 旧Pages projectの削除

## 実行前提

- Workers Buildsを`flamenode-web`だけへ接続し、`main`、Preview/PR build無効、Node 22、Build/Deploy commandを[`../../DEPLOY.md`](../../DEPLOY.md)どおり設定する。
- production Build Variables、`CLOUDFLARE_API_TOKEN`、smoke用`WORKER_ADMIN_TOKEN`を設定する。
- 各Workerへ必要なRuntime Secret名を登録する。他のRuntime Secret値をBuild環境へ複製しない。
- D1/R2/KVの実resourceを準備し、D1 migrationをbackup・レビュー後に手動適用する。
- WebとCron 3本の`workers.dev` URLを設定する。

## 合格条件

Workers Buildsの1回の実行で高速検査、OpenNext build、成果物検査、remote secret名検査、D1 read-only preflight、Web→fast→content→sync、production smokeがすべて成功し、4 Workerが同じ40桁commitを返すこと。失敗または未実施項目を成功として補完しません。

## D1

この移行作業中にRemote D1のbootstrap、migration適用、データ変更は実行していません。本番試験のread-only preflightも未実施です。
