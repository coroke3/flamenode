-- Migration: 0039_normalize_custom_questions.sql
-- Date: 2026-07-19
-- Type: data normalization
-- Summary: events.video_form_settings_json の追加質問を event_custom_questions へ移行する
-- Data loss: 不正JSON・無効化済み質問・9件目以降の旧質問は移行対象外
-- Rollback: migration前backupから events.video_form_settings_json を復元する
-- Change log: docs/database/change-log.md

-- 旧UIは質問IDを [A-Za-z0-9_-] / 64文字以内へ正規化していたため、
-- migrationではそのIDをそのまま question_key として引き継ぐ。
-- 既に同じ (event_id, question_key) が存在する場合は正規化済みデータを優先する。
INSERT OR IGNORE INTO event_custom_questions (
  id,
  event_id,
  question_key,
  label,
  description,
  type,
  required,
  options_json,
  placeholder,
  max_length,
  sort_order,
  is_active,
  visibility,
  created_at,
  updated_at
)
SELECT
  'ecq_' || lower(hex(randomblob(12))),
  e.id,
  substr(
    COALESCE(
      NULLIF(trim(json_extract(question.value, '$.id')), ''),
      CASE
        WHEN CAST(question.key AS INTEGER) = 0 THEN 'stage_permission'
        ELSE 'stage_permission_' || (CAST(question.key AS INTEGER) + 1)
      END
    ),
    1,
    64
  ),
  substr(
    COALESCE(
      NULLIF(trim(json_extract(question.value, '$.label')), ''),
      'ステージ・素材・権利まわりの使用許可'
    ),
    1,
    120
  ),
  substr(
    COALESCE(
      NULLIF(trim(json_extract(question.value, '$.description')), ''),
      'ステージ、モデル、素材、その他権利確認が必要なものについて記入してください。'
    ),
    1,
    1000
  ),
  'textarea',
  CASE WHEN json_extract(question.value, '$.required') = 1 THEN 1 ELSE 0 END,
  NULL,
  substr(
    COALESCE(
      NULLIF(trim(json_extract(question.value, '$.placeholder')), ''),
      '例：自作ステージ / 利用規約確認済み / 権利者許可済み など'
    ),
    1,
    500
  ),
  1000,
  CAST(question.key AS INTEGER),
  1,
  'review',
  COALESCE(e.created_at, unixepoch()),
  unixepoch()
FROM events AS e
JOIN json_each(e.video_form_settings_json, '$.stage_permissions') AS question
WHERE e.video_form_settings_json IS NOT NULL
  AND json_valid(e.video_form_settings_json) = 1
  AND json_type(e.video_form_settings_json, '$.stage_permissions') = 'array'
  AND json_extract(question.value, '$.enabled') = 1
  AND CAST(question.key AS INTEGER) < 8;

-- 正規化テーブルを正本に切り替えたため、旧設定JSONを保持しない。
UPDATE events
SET video_form_settings_json = NULL
WHERE video_form_settings_json IS NOT NULL;
