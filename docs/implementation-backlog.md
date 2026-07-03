# FlameNode 実装バックログ (Pre-Production Cleanup)

> 2026-07-03 update: CSV / TSV / legacy import flows require a preview before apply. Admin spreadsheet and legacy import APIs reject direct apply without the matching preview token.
> 2026-07-03 update: `operation_mode` resolution is shared across app reads and static rebuild workers. `content-jobs` now has a tested mode policy. `/list` can read `list/recent.json` in `static_only` mode.
> 2026-07-03 update: Legacy import reuses the stage-permission answer sync path. Imported `stage_permission` / legacy `righttype` values populate `video_custom_answers` when matching `event_custom_questions` exist.
> 2026-07-03 update: `/event` index can read R2 `events/index.json` in `static_only` mode. `content-jobs` includes public event group sections in that payload.
> 2026-07-04 update: Legacy import no longer writes deprecated `videos.custom_answers`; dropped legacy-only values are surfaced as import warnings.
> 2026-07-04 update: Event templates no longer copy legacy `events.custom_questions`; template snapshots store normalized `custom_question_definitions` and restore them into `event_custom_questions`.
> 2026-07-04 update: Admin spreadsheet import treats legacy compatibility columns as read-only, including event visibility flags, operation-mode fallbacks, `videos.stage_permission`, and fixed `video_chapters.marker_kind=chapter` inserts.
> 2026-07-04 update (Prompt 7): `event_group_events` を正本化し `events.event_group_id` の読み取り fallback を削除。`src/lib/publicData/loader.ts` で R2 優先 + DB fallback + 再生成キュー投入。`primary_event_id` ↔ `video_events` 同期と repair script 追加。

最終更新: 2026-07-04

## 概要

本格運用前の最終整理として、二重正本・旧仕様・中途半端な実装を整理する。
D1 を正本、R2/KV の静的 JSON は公開配信用キャッシュとする。

---

## 実装状況

| 項目 | 意図 | 現状 | 分類 | 優先度 | 対応ファイル候補 |
|------|------|------|------|--------|-----------------|
| OperationMode 化 | cost_guard_mode / is_maintenance_mode を統一 | resolver / policy / getMode を共通化。旧カラムは互換 fallback のみ | implemented | 高 | system_settings, costGuard.ts, queue.ts |
| static JSON read layer | 公開ページを R2 静的 JSON に寄せる | `loader.ts` で R2 優先 + overlay 時 DB fallback + miss 時 enqueue。`/list` `/event` 接続済み。event/video detail loader 追加、ページ全面接続は partial | partial | 高 | lib/publicData/, public pages |
| static rebuild queue policy | mode に応じた queue 処理 | maintenance停止 / economy件数制限 / read_only対象制限 / static_only highのみを policy 化 | implemented | 高 | workers/json-generator/queue.ts |
| api_endpoints 削除 | events.public_api_enabled に統一 | deprecated 表記済み | partial | 高 | schema.ts, admin pages |
| video_stats 削除 | videos 側列に統一 | schema.ts に残存 | planned | 高 | schema.ts, score-recalc worker |
| event_staff 権限正本 | permission_preset / permission_mask / custom_permission_keys_json | mask/preset 実装済み | partial | 高 | permissions/keys.ts, presets.ts, mask.ts |
| event groups 正式実装 | 複数イベント所属 | `event_group_events` 正本。legacy `events.event_group_id` クリア migration + repair script | implemented | 中 | eventGroups.ts, migrations/0039 |
| custom questions 本格実装 | event_custom_questions / video_custom_answers | 投稿経路で `replaceGeneralCustomAnswers` 配線済み。EventForm の一般質問 UI は partial | partial | 中 | EventForm, video.ts, customQuestionAnswers.ts |
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
| events.custom_questions (旧 JSON) | event_custom_questions | 新規書き込み禁止。テンプレートは `custom_question_definitions` から正規化テーブルへ復元 | write path removed |
| videos.custom_answers (旧 JSON) | video_custom_answers | 新規書き込み禁止。legacy import は旧JSON格納値を warning として扱う | write path removed |
| videos.stage_permission | video_custom_answers | 新規書き込み禁止。0037 で既存値を正規化テーブルへ backfill。汎用 spreadsheet import では読み取り専用 | write path removed |
| video_softwares | videos.used_software_json + software_catalog | 通常保存と legacy import は JSON 保存へ移行済み。旧テーブルは読み取りフォールバックのみ | implemented |
| events.is_active / is_entry_open / is_archived | events.visibility_status / entry_start_time / entry_end_time | 互換列。通常保存は同期、汎用 spreadsheet import では読み取り専用 | readonly fallback |
| system_settings.cost_guard_mode / is_maintenance_mode | system_settings.operation_mode | 互換 fallback。汎用 spreadsheet import では読み取り専用 | readonly fallback |
| video_chapters.video_member_id / marker_kind | video_members.chapters_json / marker_kind=chapter | メンバーチャプター分離後の互換列。汎用 import では `marker_kind=chapter` を強制 | readonly/fixed |

---

## 残作業 (次のPRで対応)

1. static JSON read layer 拡張 (top / event detail / video / user を R2 fallback 対応)
2. custom questions 拡張 (select / radio / checkbox UI と表示範囲)
3. event_staff permission_mask migration
4. video_stats 削除 (migration)
5. api_endpoints 削除 (events.public_api_enabled への完全移行)
6. docs/tests 最終同期
