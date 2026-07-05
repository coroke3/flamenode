# AGENTS.md

FlameNode: YouTube 埋め込み動画プラットフォーム (イベント参加・スロット・投稿審査)。Cloudflare ネイティブ。
Next.js 15 App Router + React 19 + TS / D1 + Drizzle / R2 / KV / Workers (Cron 3本) / Auth.js v5 + Discord OAuth。

## コマンド

```sh
npm run dev            # 開発サーバ (instrumentation.ts が Miniflare で D1/R2/KV 自動起動 + migration 冪等 apply)
npm run typecheck      # 変更後必須
npm run build          # 変更後必須
npm run test:unit      # node:test。テストのある領域を触ったら実行
npm run db:local-apply # ローカル D1 へ migration 適用
npm run check:db-legacy        # deprecated DB 書き込みの静的検出
npm run check:public-api-leaks # 公開 API 漏洩検査 (dev server 必須)
```

- シークレットは `.dev.vars` (コミット禁止)
- Windows では next-on-pages dev が不安定。動作確認は `npm run dev` を使う

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
| 運用手順 (migration/Worker/検査) | `docs/operations.md` |
| ローカル環境 / デプロイ | `LOCAL.md` / `DEPLOY.md` |
| 権限・ID 仕様の根拠 (2026-05 修正原典) | `.claude/flamenode/source/`, `claude-code-subagent-assignment.md` |

## ルール

1. 1 PR = 1 テーマ。small-batch
2. 変更後は `typecheck` + `build` 必須
3. スキーマ変更は migration 同伴 + `docs/operations.md` と整合。**`npm run db:generate` は使わない** (Drizzle meta が `0007` 止まりで壊れた差分が出る)。手動 SQL migration を `migrations/` に追加する
4. deploy / 本番 D1 migration はユーザー操作。実行しない
5. D1 が正本、R2/KV の静的 JSON は配信キャッシュ。二重正本を作らない

## 絶対禁止 (設計監査で確定した不変条件)

- 権限チェックをフロントのみに置く (API 直叩きの穴を残す)
- Discord ID と X ID の混同
- `owner_discord_user_id` だけで作品編集を許可
- 未承認 X ID での投稿・チャプターコメント・いいね・セーブ・ライブラリ
- `contact_x_id` 自由入力を投稿主体にする
- 連続枠を表示だけでまとめ DB 整合性を放置
- `video_comments` の新規利用 (チャプターコメントに統合済み)
- `marker_kind` 依存の分岐追加
- 公開 API で内部情報を返す
- 未実装機能を実装済みのように見せる
