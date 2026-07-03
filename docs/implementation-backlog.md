# FlameNode 実装バックログ (Pre-Production Cleanup)

> 2026-07-03 update: CSV / TSV / legacy import flows require a preview before apply. Admin spreadsheet and legacy import APIs reject direct apply without the matching preview token.
> 2026-07-03 update: `operation_mode` resolution is shared across app reads and static rebuild workers. `content-jobs` now has a tested mode policy. `/list` can read `list/recent.json` in `static_only` mode.
> 2026-07-03 update: Legacy import reuses the stage-permission answer sync path. Imported `stage_permission` / legacy `righttype` values populate `video_custom_answers` when matching `event_custom_questions` exist.

最終更新: 2026-07-03

## 概要

本格運用前の最終整理として、二重正本・旧仕様・中途半端な実装を整理する。
D1 を正本、R2/KV の静的 JSON は公開配信用キャッシュとする。

---

## 実装状況

| 項目 | 意図 | 現状 | 分類 | 優先度 | 対応ファイル候補 |
|------|------|------|------|--------|-----------------|
| OperationMode 化 | cost_guard_mode / is_maintenance_mode を統一 | resolver / policy / getMode を共通化。旧カラムは互換 fallback のみ | implemented | 高 | system_settings, costGuard.ts, queue.ts |
| static JSON read layer | 公開ページを R2 静的 JSON に寄せる | `static_only` 時の `/list` recent は R2 `list/recent.json` を利用。他ページは D1 fallback | partial | 高 | public pages, lib/publicData/ |
| static rebuild queue policy | mode に応じた queue 処理 | maintenance停止 / economy件数制限 / read_only対象制限 / static_only highのみを policy 化 | implemented | 高 | workers/json-generator/queue.ts |
| api_endpoints 削除 | events.public_api_enabled に統一 | deprecated 表記済み | partial | 高 | schema.ts, admin pages |
| video_stats 削除 | videos 側列に統一 | schema.ts に残存 | planned | 高 | schema.ts, score-recalc worker |
| event_staff 権限正本 | permission_preset / permission_mask / custom_permission_keys_json | mask/preset 実装済み | partial | 高 | permissions/keys.ts, presets.ts, mask.ts |
| event groups 正式実装 | 複数イベント所属 | DB schema + helper + 公開ページ完了 | implemented | 中 | schema.ts, eventGroups.ts, /groups |
| software catalog 候補辞書化 | 入力候補として利用 | usage_count/is_active/is_verified 追加済み | partial | 中 | softwareCatalog, admin pages |
| custom questions 本格実装 | event_custom_questions / video_custom_answers | EventForm/VideoForm の追加質問と正規化テーブル同期は実装済み。select/radio等のUIは未拡張 | partial | 中 | EventForm, VideoForm, video.ts |
| Worker 5→3 統合 | Cron Trigger 削減 | 3本構成に統合済み | implemented | 中 | workers/fast-jobs, content-jobs, sync-jobs |
| 通知・運営受信箱 | notification-outbox 基盤 | DB 作成済み | partial | 中 | notification-dispatcher |
| YouTube 同期リトライ | バックオフ / リトライ | 基本実装済み | implemented | 低 | youtube-sync worker |
| スコア / 推薦 | videos.score を正本 | score-recalc 動作中 | implemented | 低 | score-recalc worker |
| 管理 / 運営画面 UX | noindex, 影響件数, ラベル | 改善済み | implemented | 中 | admin pages |
| スマホ UI / 入力 UI | ボタンサイズ, ヒーロー, ガター, 下部バー | 改善済み | implemented | 中 | CSS modules |
| 危険操作 / 監査ログ | history_logs, 確認 UI | 基本実装済み | partial | 中 | history logs, admin pages |
| migration / Drizzle meta | 手動 migration と Drizzle meta の同期 | 手動 migration 混在 | partial | 低 | migrations/, instrumentation.ts |
| CSV import 再設計 | 用途別 import workflow | 運営メンバーCSV / admin spreadsheet / legacy import をプレビュー後保存に統一済み | implemented | 中 | eventStaffCsv, spreadsheet/import, legacy-import |
| Legacy Import Gateway | 旧データ移行 | `/admin/import` と JSON API を実装済み。apply はプレビュートークン必須 | implemented | 低 | /admin/import, api/admin/legacy-import |
| D1 schema/runtime fixes | notification-dispatcher, instrumentation, list_popular | 修正済み | implemented | 高 | workers/, instrumentation.ts |
| Cloudflare deploy | config check, system_settings ID | 整理済み | implemented | 高 | scripts/, package.json |
| 未使用コード削除 | spreadsheetUtils, safeAccentHex, CSS | 削除済み | implemented | 低 | 多数 |

---

## 削除予定 DB 要素

| 要素 | 正本 | 削除方針 | ステータス |
|------|------|---------|-----------|
| api_endpoints | events.public_api_enabled | テーブル削除 | deprecated |
| video_stats | videos.score / app_like_count / video_youtube_metadata.view_count | テーブル削除 | planned |
| event_staff_permissions | event_staff.permission_preset / permission_mask / custom_permission_keys_json | 移行元のみ / 新規書き込み禁止 | mask backfill migration |
| events.custom_questions (旧 JSON) | event_custom_questions | 新規書き込み禁止 | schema作成済み |
| videos.custom_answers (旧 JSON) | video_custom_answers | 新規書き込み禁止 | schema作成済み |
| video_softwares | videos.used_software_json + software_catalog | 削除候補 | planned |

---

## 残作業 (次のPRで対応)

1. static JSON read layer 拡張 (top / event / video / user を R2 fallback 対応)
2. custom questions 拡張 (select / radio / checkbox UI と表示範囲)
3. event_staff permission_mask migration
4. video_stats 削除 (migration)
5. api_endpoints 削除 (events.public_api_enabled への完全移行)
6. docs/tests 最終同期
