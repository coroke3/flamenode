# FlameNode 移行 — 別端末・別チャットへの引き継ぎ

このファイルは**再開時の入口**です。進捗、タスク一覧、open PR、CI結果、依存状態、予算値を複製しません。スナップショットはマージ直後に古くなるため、作業開始時に必ず正本を確認してください。

## 参照順序（正本）

1. [AGENTS.md](AGENTS.md) — リポジトリ共通制約
2. [docs/migration/MIGRATION_START_HERE.md](docs/migration/MIGRATION_START_HERE.md) — agent の最小入口
3. [docs/migration/AGENT_PROTOCOL.md](docs/migration/AGENT_PROTOCOL.md) §Wake decision — 作業・レビュー・待機の判定
4. [docs/migration/STATUS.md](docs/migration/STATUS.md) — **main にマージ済み**のタスク・依存・進捗だけの正本
5. [open PR](https://github.com/coroke3/flamenode/pulls?q=is%3Apr+is%3Aopen) と、各PRブランチの `docs/migration/work-items/MIG-XXXX.md` — **未マージ**のowner・進捗・残課題の正本
6. [docs/migration/GIT_WORKFLOW.md](docs/migration/GIT_WORKFLOW.md) — CI・独立レビュー・人間によるマージのゲート

現在の数値、PR番号、HEAD SHA、CI結果や `MIG-XXXX` と機能の対応関係はこの文書では断定しません。必ず上記の正本を現在時点で再取得します。

## 再開手順

既存の作業ツリーが clean であることを確認し、他の writer が使用中のブランチは上書きしないでください。

```bash
git status --short
git fetch origin main
git switch main
git pull --ff-only origin main
git rev-parse HEAD
gh pr list --state open --limit 100 --json number,title,isDraft,headRefName,headRefOid,url
npm ci
npm run check:project-docs
npm run migration:next -- --model small
```

- `gh` が利用できない場合は GitHub API/MCP で**全open PR**と現在のbranch HEADを取得してください。未確認のPRを「存在しない」として重複claimしてはいけません。
- `migration:next` は候補の提示であり、owner lockでも承認でもありません。既存PRの `work-items` を読み、次の未完了unitを確認します。
- 既存PRが `IN_PROGRESS` ならそのowner以外は書き込まないでください。レビューのみ可能な場合はレビューを記録し、実装ブランチのwork-item/STATUSは編集しません。
- 新規claimの場合は依存・未決Decision・対象ファイルの重複を確認してから、**1 MIG task / 1 owner / 1 Draft PR** の原則に従います。

## マージ判断

**`mergeable=true`（Git競合なし）だけではマージ可能と判定しません。** 最新HEADでの必要なCI成功、未完了unit・依存・本番安全ゲートの解消、別のレビュー担当による独立検証と承認、最新mainとの統合、必要な進捗ファイル更新が必要です。詳細な手順・例外は `AGENT_PROTOCOL.md` と `GIT_WORKFLOW.md` が優先します。

直接mainへのpush、無断自動マージ、本番CloudflareのRoute・Workers、remote D1/R2/KV、Secrets、認可・可視性の変更は、この引き継ぎメモによって許可されません。重要なテスト失敗を無視・削除してマージ可能状態を作ってはいけません。

## 端末間のhandoffで残す情報

現在作業中のPRの**最新HEAD**、そのブランチのwork-item内の `Current unit`/`Next unit`、再現コマンドと検証結果、未解決のリスク、競合するファイルowner、ロールバック方法を、そのPRまたはwork-itemに記録してください。ここには二重記録しません。

**過去の引き継ぎ内容を引用する際は必ず当時のスナップショットと明記し、最新の状態として利用しないでください。**
