# AGENTS.md

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `bec4997`
> Source of truth: `src/lib/db/schema.ts`, `migrations/` active path, `docs/README.md`, `package.json`, `wrangler.toml`

## Codex エージェント運用

- メインエージェントは要件整理、設計判断、実装方針、統合、最終検証を担当する。
- 明確に分離できる調査、テスト、ログ解析、単純変換、独立した小規模実装だけをサブエージェントへ委譲する。
- 同一ファイルを複数エージェントに同時編集させない。
- DB migration、認証・認可、セキュリティ、破壊的変更、共有型、workflowの最終所有者はLeadとする。
- サブエージェントの差分とテスト結果をLeadが再検証し、「別エージェントが直す」TODOを残さない。

## 正本

- DB構造: `src/lib/db/schema.ts`
- active migration: `migrations/`
- DB変更履歴: `docs/database/change-log.md`
- Cloudflare binding構造: `wrangler.toml`と`workers/*/wrangler.toml`
- ローカル手順: `LOCAL.md`
- デプロイ手順: `DEPLOY.md`と`.github/workflows/deploy-cloudflare.yml`
- 運用文書: `docs/operations/README.md`
- 製品・UI設計: `設計/`と`docs/operations/ui-acceptance.md`
- 未完了事項: `docs/implementation-backlog.md`

## 変更規則

- DB変更はschema、追加migration、`docs/database/change-log.md`、詳細履歴、テストを同じ変更で更新する。
- 既適用migrationのSQL本文を変更しない。
- schemaの列一覧をMarkdownへ複製しない。
- Active codeへ旧列fallback、二重書込み、runtime DDL、deprecated wrapperを戻さない。
- code変更と該当Active文書の更新を同じ変更で行う。
- Active文書へ旧識別子や存在しない構成を現行仕様として残さない。
- Cloudflare Pages + `@cloudflare/next-on-pages`、D1/R2/KV、Cron Worker 3本を維持する。
- 実Cloudflare deploy、Remote D1 migration、production secret操作は明示された運用時だけ行う。

## 完了前の検証

```sh
npm ci
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

失敗を既存問題として放置せず、全必須検査が成功してから完了とする。
