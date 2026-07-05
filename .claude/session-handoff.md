# Session Handoff (アーカイブ / 2026-05 修正キャンペーン)

> **状態**: 2026-05 の大規模修正セッションの引き継ぎ記録。当時の Batch 0a〜161 は main にコミット済みで、個々の内容は `git log` (2026-05 の日本語コミット) で追跡できる。現在の実装状況・残タスクの正本は `docs/implementation-backlog.md`。

## 当時のサマリ

- main 上で small-batch 連続実装 (Batch 0a〜161)。すべて typecheck / build 通過、commit + push 済み
- Opus 判断候補 10/10 完了 (like_count 閾値、slot gap 設定化、merge フロー Phase A〜C、broadcast 段階 enqueue、normalize core 切り出し 等)
- 単体テスト累計 127 件 (node:test)

## Opus 判断ログ (要点)

| 対象 | 判断 |
|---|---|
| Batch 151-160 差分レビュー | commit OK。禁止 11 項目・Opus 領域への違反なし |
| migration 0001-0006 本番適用 | 条件付き OK。全て nullable 列追加 + CREATE INDEX。0003 のみ `IF NOT EXISTS` 無し、事前に `PRAGMA index_list` 確認 |
| 本番 deploy | 条件付き OK。Pages deploy → D1 migration の順を推奨 (fallback 完備) |

## 当時の未適用事項 (2026-05 時点。現状は要再確認)

- migration 0001〜0006 が本番 D1 に未適用、本番 deploy も未実施
- follow-up 候補: 旧 notification_outbox の discord_user_id バックフィル / dispatcher の per-recipient throttle / internal search API の rate limit

## 進め方ルール (現行は AGENTS.md / CLAUDE.md に統合済み)

- 調査 Haiku / 通常実装 Sonnet / DB・権限・security 等 Opus
- typecheck / build / test:unit / commit / push まで自走。deploy と本番 migration のみユーザー操作
