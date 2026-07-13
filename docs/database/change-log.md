# DB Change Log

> Status: Active
> Last verified: 2026-07-13
> Verified against commit: `ba7d4ad`
> Source of truth: `migrations/` active path, `src/lib/db/schema.ts`

## 2026-07-13 — `0040_worker_free_tier_scale.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | 大規模データ時のスコア差分更新をbounded index scanにする複合indexを追加 |
| Reason | 全件ID cursor巡回を廃止し、変更済み・期限切れ作品を最大250件ずつ1 SQLで更新するため |
| Tables | `videos` |
| Data migration | なし |
| Compatibility | migration未適用でも機能するが、大量データではrows readが増える |
| Data loss | none |
| Rollback | `videos_score_refresh_idx`を削除 |
| Validation | schema/history検査、Worker/unit tests、空DBへのactive migration適用 |
| PR | `agent/cloudflare-free-tier-scale-v2` |

## 2026-07-13 — `0039_search_relation_indexes.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | 公開作品検索・クリエイター集計・公開チャプター検索の複合indexを追加 |
| Reason | 既存の検索条件と集計結果を変えず、相関EXISTSとcreator/member集計の走査量を削減するため |
| Tables | `videos`、`video_members`、`video_chapters` |
| Data migration | なし |
| Compatibility | 読み取り結果は不変。migration未適用でも機能するが処理効率が低下する |
| Data loss | none |
| Rollback | `videos_creator_public_idx`、`video_members_x_user_video_idx`、`video_chapters_video_visibility_idx`を削除 |
| Validation | schema/history検査、公開API・Worker・unit tests、空DBへのactive migration適用 |
| PR | main直接実装 |

## 2026-07-13 — `0038_runtime_efficiency_resilience.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | Worker leaseの最終実行状態列と、公開一覧・認証・アイコン補完の頻出読取用複合indexを追加 |
| Reason | Cronの障害状態を保存し、公開・認証経路をbounded queryのまま維持するため |
| Tables | `worker_leases`、`videos`、`events`、`x_users` |
| Data migration | なし。追加列は既存行で`NULL`から開始 |
| Compatibility | runtime DDLなし。列を読むコードより先にmigration適用が必要 |
| Data loss | none |
| Rollback | index削除。追加列の除去が必要な場合はmigration前backupから手動復元 |
| Validation | schema/history検査、Worker/unit tests、空DBへのactive migration適用 |
| PR | main直接実装 |

## 2026-07-13 — `0003_large_collaboration_support.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | 大規模合作向けに audit_log_settings.max_payload_bytes の DEFAULT/値を 120000 へ引き上げ |
| Reason | 完全なメンバーsnapshotを監査・復元可能な範囲で保持するため |
| Tables | `audit_log_settings` |
| Data migration | 既定行の上限値が120000未満の場合だけ更新 |
| Compatibility | runtime fallbackなし。migration未適用時は巨大メンバー集合の監査がペイロード超過になりうる |
| Data loss | none |
| Rollback | migration前backupから手動復元 |
| Validation | schema/history検査、typecheck |
| PR | main直接実装 |

## 2026-07-13 — `0002_terms_reaccept_manual_cost_guard.sql`

| 項目 | 内容 |
| --- | --- |
| Type | cleanup |
| Summary | 規約再同意のbounded検索を追加し、CostGuardを手動制御へ統一 |
| Reason | 実測collectorのない自動判定を正本にせず、再同意対象を効率よく抽出するため |
| Tables | `user`、`terms_versions`、`user_tos_consents`、`system_settings`。`cost_usage_snapshots`は削除 |
| Data migration | `user_tos_consents`をFK付きの新tableへコピーして置換 |
| Compatibility | runtime fallbackなし。新コードの前に運用者がbackupとmigration適用を確認 |
| Data loss | 未計測snapshot tableと未使用の自動判定設定2列を削除 |
| Rollback | migration前backupから手動復元 |
| Validation | schema/history検査、再同意/CostGuard unit・integration |
| PR | main直接実装 |

## 2026-07-13 — `0001_spreadsheet_import_runs.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | Spreadsheet import previewのHMAC nonceを一度だけ原子的に消費する短期runを追加 |
| Reason | previewとapplyの差し替え・再利用を防ぎ、同一planだけを一度適用するため |
| Tables | `spreadsheet_import_runs` |
| Data migration | なし |
| Compatibility | runtime fallbackなし。migration未適用時はpreview/applyをfail-closed |
| Data loss | none |
| Rollback | manual |
| Validation | schema/history検査、HMAC unit、SQLite transaction integration |
| PR | main直接実装 |

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
| PR | main直接実装 |

Legacy import staging: `legacy_import_batches` persists canonical plan JSON, preview expiry, one-time lease, and consumed timestamp. The apply request is never the canonical source.
