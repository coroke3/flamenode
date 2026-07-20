# DB Change Log

> Status: Active
> Last verified: 2026-07-20
> Verified against commit: `3d85540`
> Source of truth: `migrations/` active path, `src/lib/db/schema.ts`

## 2026-07-20 — `0043_simplify_visibility_statuses.sql`

| 項目 | 内容 |
| --- | --- |
| Type | cleanup |
| Summary | 作品とイベントの公開状態を簡素化し、YouTube限定公開をYouTubeメタデータへ分離 |
| Reason | FlameNode内の公開範囲とYouTube上の公開区分を混在させず、下書き・アーカイブの重複した役割を廃止するため |
| Tables | `videos`、`video_youtube_metadata`、`video_moderation_cases`、`events` |
| Data migration | 動画`limited`を`public`へ移しYouTube公開区分を`unlisted`として保存。動画`draft / archived / hidden`を`private`、イベント`draft`を`private`、`archived`を`public`へ移行。旧partial unique indexで許されていた全YouTube ID重複を順位付けし、代表以外は行を保持したまま`voided`へ移してIDを解除し、理由と元IDをモデレーション履歴へ記録 |
| Compatibility | runtimeで旧状態を読み替えない。active baselineは変更せず、旧defaultをINSERT直後にcanonicalへ正規化し、UPDATEで旧状態を拒否するtriggerを追加 |
| Data loss | none。作品・イベント行は削除せず、解除した重複YouTube IDも監査可能な形で保持 |
| Rollback | 状態の意味と全状態共通unique indexが変わるため、migration適用前のD1バックアップから復元 |
| Validation | typecheck、Lint、unit、Worker、Cloudflare契約、SQLite integration、Next.js/Pages build、schema/history、公開API検査 |
| PR | `#88` |

## 2026-07-13 — `0041_youtube_quota_budget.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | 単一YouTube APIキーの日次quota使用量を太平洋時間の日付単位で原子的に管理するテーブルを追加 |
| Reason | 標準10,000 units/dayの80%＝8,000 unitsをFlameNode全体の上限にし、同期・将来の再生リスト処理が同じ予算を共有できるようにするため |
| Tables | `external_api_quota_usage` |
| Data migration | なし |
| Compatibility | migration未適用時はYouTube同期を開始せずfail-closedにする |
| Data loss | none |
| Rollback | `external_api_quota_usage`を削除 |
| Validation | schema/history検査、Worker/unit tests、空DBへのactive migration適用 |
| PR | `agent/youtube-single-key-quota-budget` |

## 2026-07-13 — `0042_event_youtube_playlist_sync.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | イベント単位のYouTube再生リスト同期設定と、差分同期用の再生リスト項目索引を追加 |
| Reason | 設定済みイベントだけを再生リストへ同期し、メタデータ同期と同じ日次80% quota予算を共有するため |
| Tables | `event_youtube_playlist_sync`、`event_youtube_playlist_items` |
| Data migration | なし。全イベントで同期無効から開始 |
| Compatibility | migration未適用時は設定画面・同期Workerをfail-closed |
| Data loss | none |
| Rollback | 同期を無効化後、項目索引テーブル、設定テーブルの順で削除 |
| Validation | schema/history、playlist parser/diff、共有quota、Worker、Next.js/Pages build |
| PR | `agent/youtube-playlist-main-integration` |

## 2026-07-13 — `0040_worker_free_tier_scale.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | 大規模データ時のスコア差分更新をbounded index scanにする複合indexを追加 |
| Reason | 全件ID cursor巡回を廃止し、変更済み・期限切れ作品を最大150件ずつ1 SQLで更新し、index entryを含むD1 rows writtenの日次余裕を確保するため |
| Tables | `videos` |
| Data migration | なし |
| Compatibility | migration未適用でも機能するが、大量データではrows readが増える |
| Data loss | none |
| Rollback | `videos_score_refresh_idx`を削除 |
| Validation | schema/history検査、Worker/unit tests、空DBへのactive migration適用 |
| PR | `agent/cloudflare-free-tier-scale-v3` |

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
