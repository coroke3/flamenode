# DB Change Log

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `agent/youtube-playlist-free-tier`
> Source of truth: `migrations/` active path, `src/lib/db/schema.ts`, `src/lib/db/schema.youtube-playlist.ts`

## 2026-07-13 — `0004_event_youtube_playlist_sync.sql`

| 項目 | 内容 |
| --- | --- |
| Type | schema |
| Summary | イベント単位のYouTube再生リスト同期設定と、差分同期用の再生リスト項目索引を追加 |
| Tables | `event_youtube_playlist_sync`、`event_youtube_playlist_items` |
| Compatibility | runtime fallbackなし。migration未適用時は設定画面・同期Workerをfail-closed |
| Data loss | none |
| Rollback | 同期を無効化後、項目索引テーブル、設定テーブルの順で削除 |
| Validation | schema/history検査、playlist parser/diff unit、typecheck |

## 2026-07-13 — `0003_large_collaboration_support.sql`

| 項目 | 内容 |
| --- | --- |
| Type | schema |
| Summary | 大規模合作向けに audit_log_settings.max_payload_bytes の DEFAULT/値を 120000 へ引き上げ |
| Tables | `audit_log_settings` |
| Compatibility | runtime fallbackなし。migration未適用時は巨大メンバー集合の監査がペイロード超過になりうる |
| Data loss | none |
| Rollback | migration前backupから手動復元 |
| Validation | schema/history検査、typecheck |

## 2026-07-13 — `0002_terms_reaccept_manual_cost_guard.sql`

| 項目 | 内容 |
| --- | --- |
| Type | destructive cleanup + additive indexes/FK |
| Summary | 規約再同意のbounded検索を追加し、CostGuardを手動制御へ統一 |
| Tables | `user`、`terms_versions`、`user_tos_consents`、`system_settings`。`cost_usage_snapshots`は削除 |
| Compatibility | runtime fallbackなし。新コードの前に運用者がbackupとmigration適用を確認 |
| Data loss | 未計測snapshot tableと未使用の自動判定設定2列を削除 |
| Rollback | migration前backupから手動復元 |
| Validation | schema/history検査、再同意/CostGuard unit・integration |

## 2026-07-13 — `0001_spreadsheet_import_runs.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | Spreadsheet import previewのHMAC nonceを一度だけ原子的に消費する短期runを追加 |
| Tables | `spreadsheet_import_runs` |
| Compatibility | runtime fallbackなし。migration未適用時はpreview/applyをfail-closed |
| Data loss | none |
| Rollback | manual |
| Validation | schema/history検査、HMAC unit、SQLite transaction integration |

## 2026-07-11 — `0000_flame_node_baseline.sql`

| 項目 | 内容 |
| --- | --- |
| Type | baseline |
| Summary | pre-production用の最終canonical schemaを空D1へ一括作成する。 |
| Reason | 起動時の自動スキーマ適用と旧列の互換経路を廃止し、schemaとactive pathを一意化する。 |
| Tables | Auth、X ID、event/slot/video、audit、queue/outbox、static artifact、worker leaseを含む全active table。 |
| Data migration | なし。旧migrationは `migrations/historical/` へ内容を保ったまま分離。 |
| Compatibility | 旧列・旧tableとのruntime互換は提供しない。 |
| Data loss | intentional。Remote D1や本番データを自動初期化しない。 |
| Rollback | not safely reversible。必要時は運用者がbackupから復旧する。 |
| Validation | `check:db-schema`、`check:db-history`、空SQLiteへのbaseline適用。 |
| PR | current working tree |

Legacy import staging: `legacy_import_batches` persists canonical plan JSON, preview expiry, one-time lease, and consumed timestamp. The apply request is never the canonical source.
