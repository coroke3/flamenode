# AGENTS.md

> Status: Active
> Last verified: 2026-07-25
> Verified against commit: `dc46eefa`
> Source of truth: `src/lib/db/schema.ts`, `migrations/`, `package.json`, `wrangler.toml`

## 開始（これだけ）

1. この文書を読む。
2. [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md) の **該当タスク行だけ** を読む。
3. 対象コードと関連 test を直接読む。必要なら Active 文書を **追加1件**。

禁止: リポジトリ全体、`.claude/flamenode/source/`、`archive/`、完了済み phase、Historical の一括読込。

## 矛盾時の優先順位

1. 現行コード・設定・test
2. `src/lib/db/schema.ts` と `migrations/`
3. Status が `Active` の文書（このファイルが規範）
4. `設計/` の現行設計
5. Historical / archive / 旧監査（経緯のみ。現行根拠にしない）

## 正本リンク

| 領域 | 正本 |
| --- | --- |
| DB構造 | `src/lib/db/schema.ts` |
| migration | `migrations/` |
| DB履歴 | `docs/database/change-log.md` |
| binding | `wrangler.toml`, `workers/*/wrangler.toml` |
| ローカル | `LOCAL.md` |
| デプロイ | `DEPLOY.md`（初回準備は `docs/operations/deploy-setup-report.md`） |
| 運用入口 | `docs/operations/README.md` |
| タスク導線 | `docs/AI_CONTEXT.md` |
| 未完了 | `docs/implementation-backlog.md` |

## 不変条件

- 既存挙動を変えない依頼では、公開API・権限・DB副作用・表示結果を維持する。
- 既適用 migration の SQL 本文を変更しない。schema 列一覧を Markdown へ複製しない。
- 旧列 fallback、二重書込み、runtime DDL、deprecated wrapper を Active code へ戻さない。
- 旧形式入力は `/admin/import`・`/api/admin/import/legacy`・`src/lib/import/legacy/` 以外へ広げない。
- `event_staff.permission_preset = 'owner'` が代表者正本。owner を 0 人にしない。
- 権限は UI だけでなく Server Action または Route Handler で検証する。
- 公開APIは明示 DTO だけを返す。
- 構成を維持: Cloudflare Workers + OpenNext + Workers Static Assets、D1、R2、KV、Queue 6本（wake 3 + DLQ 3）、Recovery Cron Worker 3本。
- production は Cloudflare Workers Builds の単一 Git 連携のみ。deploy 順は Web→fast→content→sync→smoke。
- Remote D1 の deploy 前検査は read-only。migration の自動適用はしない。
- 実 Cloudflare deploy、Remote D1、production secret 操作は **明示依頼時だけ**。

## 作業規則

- 依頼を1文で固定し、対象と非対象を先に決める。
- 読む文書は原則3件以内（この文書 + AI_CONTEXT 行 + Active 1件）。
- 同一情報を複数文書から集めない。同一ファイルを複数エージェントへ同時編集させない。
- DB・認証・security・公開API・破壊的変更・共有型の最終判断は Lead。
- code と該当 Active 文書を同じ変更で更新する。Historical は書き換えない。
- サブエージェントの差分と test 結果は Lead が再確認する。

## モデル選択と停止

| 帯 | 用途 |
| --- | --- |
| 軽量 | 検索、一覧、単純置換、限定的な文書修正、test 結果整理 |
| 中位 | 境界が明確な通常実装、局所リファクタ |
| 上位 | DB、権限、security、公開API、破壊的変更、仕様衝突、最終レビュー |

軽量モデルは次の場合 **実装を止めて上位へ上げる**。

- 正本が一意に決まらない
- 変更が3領域以上へ波及する
- migration、権限緩和、データ削除、公開項目追加を含む
- 既存 test と依頼が衝突する
- Cloudflare 実操作・Remote D1・production secret が必要

## 検査

変更種別に必要なものだけ実行する。選び方は `docs/AI_CONTEXT.md` §7。未実行は理由を書く。

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:workers
npm run test:integration
npm run verify:fast
npm run verify:full
npm run check:docs
npm run check:project-docs
npm run check:db-schema
npm run check:db-legacy
npm run check:public-api-contract
```

全スクリプト一覧が必要なときだけ `package.json` を見る。

## 完了報告

変更内容 / 維持した挙動 / 実行した検査と結果 / 未実行と理由 / 残課題
