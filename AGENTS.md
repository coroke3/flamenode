# AGENTS.md

## Codex エージェント運用

- メインエージェントは要件整理、設計判断、実装方針、統合、最終検証を担当する。
- 明確に分離できる調査、テスト、ログ解析、単純変換、独立した小規模実装は `luna_worker` へ委譲する。
- サブエージェントの利用自体を目的にせず、一工程だけの小さな作業では起動しない。
- 並列化するのは独立作業だけとし、同一ファイルを複数のサブエージェントに同時編集させない。
- 設計変更、DB migration、認証・認可、セキュリティ、破壊的変更、最終レビューはメインエージェントが担当する。
- メインエージェントはサブエージェントの出力をそのまま採用せず、差分とテスト結果を必ず検証する。

> Status: Active
> Last verified: 2026-07-13
> Source of truth: `src/lib/db/schema.ts`, `migrations/0000_flame_node_baseline.sql`, `docs/README.md`

FlameNode: YouTube 埋め込み動画プラットフォーム (イベント参加・スロット・投稿審査)。Cloudflare ネイティブ。
Next.js 15 App Router + React 19 + TS / D1 + Drizzle / R2 / KV / Workers (Cron 3本) / Auth.js v5 + Discord OAuth。

## コマンド

```sh
npm run dev            # 開発サーバ (ローカル D1/R2/KV binding を利用。migration は事前に手動適用)
npm run typecheck      # 変更後必須
npm run build          # 変更後必須
npm run test:unit      # node:test。テストのある領域を触ったら実行
npm run db:local-apply # ローカル D1 へ migration 適用
npm run check:db-legacy        # deprecated DB 書き込みの静的検出
npm run check:public-api-leaks # 公開 API 漏洩検査 (dev server 必須)
```

- シークレットは `.dev.vars` (コミット禁止)
- Windows では edge runtime の本番相当devが不安定。通常確認は `npm run dev`、Pages相当確認は `npm run pages:dev` を使う

## 構成 (非自明な点のみ)

- `app/(public)|(auth)|(manage)|(admin)`: 順にログイン不要 / Discord ログイン / event_staff 権限 / role=admin
- `src/lib/publicData/`: 公開 API の whitelist DTO 層。公開レスポンスは必ずここを経由
- `workers/`: デプロイは統合3本 (`fast-jobs`/`content-jobs`/`sync-jobs`) のみ。他は import 用モジュール
- CSS は `globals.css` + `*.module.css`。**Tailwind 禁止**。UI に絵文字禁止 (SVG アイコンを使う)。UI 文言は日本語

## ドキュメント正本

| 目的 | 場所 |
|---|---|
| 設計仕様 (SSoT) | `設計/FlameNode-Design.md`, `設計/FlameNode-Design-System.md`, `設計/設計app/**/*.md` |
| 残タスク・実装状況 | `docs/implementation-backlog.md` |
| 運用手順 (migration/Worker/検査) | `docs/operations/README.md`, `docs/operations/migrations.md` |
| DB履歴・テンプレート | `docs/db-history/README.md`, `docs/db-change-history.md`, `docs/templates/migration.md` |
| ローカル環境 / デプロイ | `LOCAL.md` / `DEPLOY.md` |
| 権限・ID 仕様の根拠 (2026-05 修正原典) | `.claude/flamenode/source/`, `claude-code-subagent-assignment.md` |

## ルール

1. 1 PR = 1 テーマ。small-batch
2. 変更後は `typecheck` + `build` 必須
3. スキーマ変更は migration 同伴 + `docs/operations/migrations.md` と整合。自動生成ではなく手動 SQL migration を `migrations/` に追加する
4. deploy / 本番 D1 migration はユーザー操作。実行しない
5. D1 が正本、R2/KV の静的 JSON は配信キャッシュ。二重正本を作らない
6. 起動時の自動スキーマ適用、旧列fallback、二重書き込みを行わない。Remote D1 migration/deployは運用者の明示操作に限る

## 絶対禁止 (設計監査で確定した不変条件)

- 権限チェックをフロントのみに置く (API 直叩きの穴を残す)
- Discord ID と X ID の混同
- 投稿記録や表示用ミラーだけで作品編集を許可
- 未承認 X ID での投稿・チャプターコメント・いいね・セーブ・ライブラリ
- `contact_x_id` 自由入力を投稿主体にする
- 連続枠を表示だけでまとめ DB 整合性を放置
- `video_comments` の新規利用 (チャプターコメントに統合済み)
- `marker_kind` 依存の分岐追加
- 公開 API で内部情報を返す
- 未実装機能を実装済みのように見せる
