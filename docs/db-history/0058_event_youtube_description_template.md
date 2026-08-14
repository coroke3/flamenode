# 0058_event_youtube_description_template.sql

> Status: Active
> Date: 2026-08-15
> Type: additive
> Source of truth: `migrations/0058_event_youtube_description_template.sql`, `src/lib/db/schema.ts`

## 目的 (Purpose)

Add an optional per-event plain-text template used to generate a copy-ready YouTube description on the video edit screen.

## 変更内容 (Changes)

- Add `events.youtube_description_template` as a nullable `TEXT` column.
- Keep the field behind the existing `event.basic` edit permission.
- Render only an explicit allow-list of `{{variable_name}}` placeholders. Unknown placeholders are omitted from the copied text and reported in the preview.
- Do not expose the template through public API DTOs and do not add an index; the field is read with the existing event-row lookup.

## データ損失 (Data loss)

None. Existing events keep a `NULL` template and retain their current behavior.

## ロールバック (Rollback)

No destructive rollback is provided. Restore from a verified D1 backup/manual schema procedure if rollback is required.

## 検証 (Validation)

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- `src/lib/event/youtubeDescriptionTemplate.test.mjs`
- typecheck and UI/unit tests
