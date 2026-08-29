## 2026-08-29 — `0061_event_required_video_fields.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | イベントごとに投稿フォームの任意項目を必須指定できる JSON 配列列を追加 |
| Reason | 表示名とタイトル以外の入力項目を、イベント運営が個別に必須へ切り替えられるようにするため |
| Tables | `events` |
| Data migration | none |
| Compatibility | 既存イベントは NULL（追加必須なし）。公開 DTO には出さない |
| Data loss | none |
| Rollback | 検証済みバックアップから復元。列は手動削除しない |
| Validation | `check:db-schema`、`check:db-migration`、`check:db-history`、requiredVideoFields unit tests |
