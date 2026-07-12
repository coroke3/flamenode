# DB 正本化・レガシー打ち切り (0044)

## 概要

本格運用前に DB スキーマの正本を `src/lib/db/schema.ts` に一本化し、後方互換用の列・テーブル・fallback を削除した。

## Migration

- `migrations/0044_db_canonical_cleanup.sql`
  - `operation_mode` backfill
  - `event_group_events` backfill
  - `video_member_chapters` 新設 + backfill
  - 削除: `history_logs`, `event_staff_permissions`, `video_softwares`, `video_stats`, `api_endpoints`, `video_comments`
  - 列除去: `events` 旧公開フラグ / `video_form_settings_json`, `videos.stage_permission` / `custom_answers`, `video_members.chapters_json`, `video_chapters.marker_kind` / `video_member_id`, `system_settings.cost_guard_mode` / `is_maintenance_mode`

`0044` は `migrations/historical/` に保持する履歴資料であり、runtime から自動適用しない。新規ローカル DB は active baseline を `npm run db:local-apply` で手動適用する。

## 正本マッピング

| 旧 | 新 |
|---|---|
| `history_logs` | `audit_logs` + `auditAction()` |
| `events.is_active` 等 | `events.visibility_status` + `entry_*_time` |
| `events.video_form_settings_json` | `event_custom_questions` (stage_permission 系) |
| `videos.stage_permission` | `video_custom_answers` |
| `video_members.chapters_json` | `video_member_chapters` |
| `video_softwares` | `videos.used_software_json` |
| `event_staff_permissions` | `event_staff.permission_mask` |
| `cost_guard_mode` / `is_maintenance_mode` | `system_settings.operation_mode` |

## 削除した機能

- Legacy import (`src/lib/legacy/*`, `/admin/import`, `/api/admin/legacy-import`)
- `LEGACY_PERMISSION_ALIASES`
- `syncLegacyEventVisibilityFlags`
- cleanup Worker の `history_logs` 削除ブロック

## 検証

```bash
npm run typecheck
npm run lint
npm run build
node scripts/check-db-legacy.mjs
```

## 公開 API 互換

`/api/events` のレスポンス DTO は `is_active` / `is_entry_open` / `is_archived` を維持するが、DB 列ではなく `visibility_status` と受付期間から算出する。
