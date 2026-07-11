# Incident Response

> Status: Active
> Last verified: 2026-07-11
> Verified against commit: `src/lib/cloudflare.ts`, `src/lib/auth/writeGuard.ts`

DB bindingやschema versionが不一致なら、認証・書き込みをfail-closedで停止する。まず`/api/health`、Worker `/health`、Cloudflare bindings、直近の構造化ログを確認する。secretやIDをログ、Issue、監査snapshotへ貼り付けない。
