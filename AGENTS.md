# AGENTS.md

> Status: Active
> Last verified: 2026-07-14
> Verified against commit: `6dbe07a`
> Source of truth: `src/lib/db/schema.ts`, `migrations/`, `package.json`, `wrangler.toml`

## 開始手順

1. この文書を読む。
2. [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md)の該当タスク行だけを読む。
3. 対象コード、関連test、必要なActive文書を直接確認する。

リポジトリ全体、`.claude/flamenode/source/`、`archive/`、完了済みphase資料を先に一括読込しない。

## 優先順位

矛盾時は次の順で判断する。

1. 現行コード、設定、test
2. `src/lib/db/schema.ts`と`migrations/`
3. Statusが`Active`の文書
4. `設計/`の現行設計
5. Historical、archive、旧監査資料

## 正本

- DB構造: `src/lib/db/schema.ts`
- active migration: `migrations/`
- DB変更履歴: `docs/database/change-log.md`
- Cloudflare binding: `wrangler.toml`、`workers/*/wrangler.toml`
- ローカル手順: `LOCAL.md`
- デプロイ: `DEPLOY.md`、`.github/workflows/deploy-cloudflare.yml`
- 運用: `docs/operations/README.md`
- AI読取表: `docs/AI_CONTEXT.md`
- 未完了事項: `docs/implementation-backlog.md`

## 不変条件

- 既存挙動を変更しない依頼では、公開API、権限、DB副作用、表示結果を維持する。
- 既適用migrationのSQL本文を変更しない。
- schema列一覧をMarkdownへ複製しない。
- 旧列fallback、二重書込み、runtime DDL、deprecated wrapperをActive codeへ戻さない。
- `event_staff.permission_preset = 'owner'`を代表者の正本とし、ownerを0人にしない。
- 権限はUIだけでなくServer ActionまたはRoute Handlerで検証する。
- 公開APIは明示DTOだけを返す。
- Cloudflare Pages + `@cloudflare/next-on-pages`、D1、R2、KV、Cron Worker 3本を維持する。
- 実Cloudflare deploy、Remote D1、production secret操作は明示依頼時だけ行う。

## 作業規則

- 依頼を1文で固定し、対象と非対象を先に決める。
- 読む文書は原則3件以内。追加読取は不足根拠がある場合だけ行う。
- 同一情報を複数文書から収集しない。
- 同一ファイルを複数エージェントへ同時編集させない。
- DB、認証・認可、security、公開API、破壊的変更、共有型の最終判断はLeadが行う。
- code変更と該当Active文書を同じ変更で更新する。
- Historical文書は現行仕様へ書き換えず、経緯として保持する。
- サブエージェントの差分とtest結果をLeadが再確認する。

## モデル選択

- 軽量モデル: 検索、一覧化、単純変換、限定的な文書修正、test結果整理
- 中位モデル: 境界が明確な通常実装、局所リファクタ
- 上位モデル: DB、権限、security、公開API、仕様衝突、破壊的変更、最終レビュー

軽量モデルは、正本が一意でない、3領域以上へ波及する、データ破壊の可能性がある場合に実装を止めて上位モデルへ引き上げる。

## 検査

変更種別に必要な検査を選び、未実行項目は理由を明記する。

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

## 完了報告

- 変更内容
- 維持した挙動
- 実行した検査と結果
- 未実行の検査と理由
- 残課題
