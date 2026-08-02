# DB Change Log

> Status: Active
> Last verified: 2026-08-02
> Verified against commit: `bdeb758a`
> Source of truth: `migrations/` active path, `src/lib/db/schema.ts`

## 2026-08-02 — `0052_video_interactions_auth_expand.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | Auth user 単位のいいね・セーブ正本 `video_interactions_auth` を追加し、owner が 1 人の既存行だけをバックフィル |
| Reason | Active X 切替でライブラリが変わらないよう、FlameNode 内反応を Auth user 正本へ移行するため |
| Tables | `video_interactions_auth`（参照: `users`, `videos`, `x_user_account_links`）、`_migration_0052_backfill_report` |
| Data migration | `video_interactions` から owner 1 人の x_user_id のみ `INSERT OR IGNORE`。owner 0 / 複数は report へ記録 |
| Compatibility | 旧 `video_interactions` は維持。runtime の新規書き込みは `video_interactions_auth` のみ |
| Data loss | none |
| Rollback | migration 適用前の D1 バックアップから復元 |
| Validation | `check:db-schema`, `check:video-interactions-auth`, unit test, typecheck |
| PR | Agent E v9 第1波 |

## 2026-08-01 — `0047_backfill_youtube_metadata_pending.sql`

| 項目 | 内容 |
| --- | --- |
| Type | data-migration |
| Summary | YouTube ID を持つ既存作品のうち、欠損している `video_youtube_metadata` 行を `pending` で補完 |
| Reason | YouTube 同期対象から漏れていた旧作品を安全に再検証し、R2 `top.json` の「懐かしの映像」候補へ反映できるようにするため |
| Tables | `video_youtube_metadata`（参照: `videos`） |
| Data migration | 非 `voided`・YouTube ID あり・metadata 欠損の作品だけ `INSERT OR IGNORE`。既存同期結果は更新しない |
| Compatibility | `0046` 完了後に適用。同期Workerが `pending` を処理し、公開・限定公開と確認できた作品だけ静的JSONへ掲載 |
| Data loss | none |
| Rollback | migration 適用前バックアップとの差分にある `pending` 行だけを削除 |
| Validation | `check:db-schema`、integration test、Worker test、typecheck |
| PR | （本変更） |

## 2026-08-01 — `0046_video_creator_profile_snapshot.sql`

| 項目 | 内容 |
| --- | --- |
| Type | additive |
| Summary | videos に提出者プロフィールスナップショット列 `creator_profile_text` / `creator_other_social_links` を追加し、既存行を x_users からバックフィル |
| Reason | 作品提出時点のプロフィールを videos 側へ固定し、後から x_users が変わっても過去作品表示を安定させるため |
| Tables | `videos` |
| Data migration | `creator_profile_text` / `creator_other_social_links` を x_users からコピー。`creator_youtube_channel_url` / `creator_icon_url` が NULL の行も同様に補完 |
| Compatibility | `0045` 完了後の canonical 状態のみ適用。過去提出時点の値は復元不可（実行時点の x_users を固定） |
| Data loss | none |
| Rollback | migration 適用前の D1 バックアップから復元 |
| Validation | `check:db-schema`、integration test、typecheck |
| PR | （本変更） |

## 2026-07-31 — `0045_align_visibility_defaults.sql`

| 項目 | 内容 |
| --- | --- |
| Type | cleanup |
| Summary | events/videos の物理 default を `private` / `pending` に揃え、INSERT 正規化 trigger を削除 |
| Reason | Drizzle 正本と物理 DB default の不一致、および `INSERT RETURNING` 時の値ずれリスクを解消するため |
| Tables | `events`、`videos` |
| Data migration | なし（既存行の visibility_status は変更しない） |
| Compatibility | `0044` 完了後の canonical 状態のみ適用。reject/update trigger は維持 |
| Data loss | none |
| Rollback | migration 適用前の D1 バックアップから復元 |
| Validation | `check:db-schema`、integration test、typecheck、unit、workers |
| PR | （本変更） |

## 2026-07-20 — `0044_simplify_visibility_statuses.sql`

| 項目 | 内容 |
| --- | --- |
| Type | cleanup |
| Summary | 修正後DB正本への移行後に、作品・イベントのアプリ運用状態を整理し、YouTube限定公開をYouTubeメタデータへ分離 |
| Reason | FlameNode内の公開範囲とYouTube上の公開区分を混在させず、下書き・アーカイブの重複した役割を廃止するため |
| Tables | `videos`、`video_youtube_metadata`、`video_moderation_cases`、`events` |
| Data migration | 動画`limited`を`public`へ移しYouTube公開区分を`unlisted`として保存。動画`draft / archived / hidden`を原則`private`、イベント`draft`を`private`、`archived`を`public`へ移行。`archived`から`private`への変換で既存部分一意制約に抵触する行だけ、YouTube IDを保持したまま監査付きで`voided`へ振り分け |
| Compatibility | `0043`完了をguardで確認。旧物理default由来の`draft`だけをINSERT後に正規化し、その他の旧状態のINSERT・UPDATEを拒否 |
| Data loss | none。作品・イベント行と`videos.youtube_video_id`は削除しない |
| Rollback | 状態の意味が変わるため、migration適用前のD1バックアップから復元 |
| Validation | 41テーブル409カラムの正本検査、誤順序適用のfail-fast、SQLite integration、typecheck、Lint、unit、Worker、Cloudflare契約、Next.js/Pages build、公開API検査 |
| PR | `#88`（`#89`に依存） |

## 2026-07-20 — `0043_db_canonical_migration.sql`

| 項目 | 内容 |
| --- | --- |
| Type | destructive |
| Summary | X名義・申請・イベントowner・作品関連・監査設定を41テーブル409カラムの修正後正本へ移行し、旧テーブル8件・旧カラム25件・旧名称2件を削除 |
| Reason | 本格運用前に重複正本と直接FKを廃止し、一般ランタイムを新正本だけへ統一するため |
| Tables | `x_identity_requests`、`x_user_account_links`、`x_users`、`events`、`event_staff`、`videos`、`video_members`、`video_chapters`、`system_settings`ほか |
| Data migration | 旧X申請・直接userリンク・owner・JSONチャプター・YouTube動画ID・監査設定を新正本へ変換。`events.max_slots_per_video`は保持 |
| Compatibility | 一般ランタイムの後方互換は提供しない。旧形式インポートは入力をcanonical planへ変換し、新正本だけへ保存 |
| Data loss | intentional。廃止済み機能、外部由来interaction、候補履歴、旧移行管理テーブルを削除 |
| Rollback | 適用前D1バックアップと0043適用前アプリケーションを同時に復元 |
| Validation | Node SQLiteの空DB・旧fixture・不正旧データ・途中状態4系統に加え、WranglerローカルD1で空DB/旧fixtureを適用。41テーブル409カラム、旧8テーブル/旧25カラム/旧名称2件不存在、owner/FK違反0、件数・名称変更・max_slots一致 |
| PR | `agent/db-canonical-migration-v2` |

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
| Validation | schema/history検査、公開API・Worker・unit tests、空SQLiteへのactive migration適用 |
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

旧形式インポートのpreviewは `spreadsheet_import_runs` の一度限りnonceとR2上のcanonical planで保護する。apply request bodyや旧DBテーブルを正本にしない。
