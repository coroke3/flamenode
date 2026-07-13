# 最新の本番試験結果

> Status: Active
> Result: BLOCKED (production configuration missing)
> Candidate commit: `8273a9cb0d3610e4e82075ee418375dbc26baae3`
> Completed at: 2026-07-13T04:22:41Z
> Workflow run: `29223776574`

## 結果

本番試験workflowは起動しましたが、Cloudflareへの接続前にproduction設定検査でfail-closedしました。Pages、fast-jobs、content-jobs、sync-jobsのデプロイとproduction smoke testは実行されていません。

不足していたGitHub Actions Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CF_IDS_JSON`
- `AUTH_SECRET`
- `AUTH_DISCORD_ID`
- `AUTH_DISCORD_SECRET`

不足していたGitHub Actions Variables:

- `NEXT_PUBLIC_SITE_URL`
- `FAST_JOBS_URL`
- `CONTENT_JOBS_URL`
- `SYNC_JOBS_URL`

## コード側検証

production候補と同じ実装について、依存関係、lockfile、typecheck、lint、unit tests、Worker tests、Cloudflare契約test、integration tests、Next.js production build、Cloudflare Pages build、Pages成果物、Cloudflare fixture、DB/owner、UI受入、文書・DB履歴の全CI工程が成功しています。

## D1

この試験ではRemote D1のbootstrap、migration適用、データ変更を実行していません。
