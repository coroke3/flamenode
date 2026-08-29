# 0061_event_required_video_fields.sql

> Status: Active
> Migration: 0061_event_required_video_fields.sql
> Date: 2026-08-29
> Type: additive
> Data loss: none
> Rollback: 検証済みバックアップから復元。破壊的 rollback は使わない
> Change log: docs/database/change-log.d/0061_event_required_video_fields.md
> Source of truth: `migrations/0061_event_required_video_fields.sql`, `src/lib/db/schema.ts`

## 目的 (Purpose)

イベント運営が、投稿フォームの任意項目をイベント単位で必須指定できるようにする。表示名と作品タイトルは従来どおり常に必須とし、指定リストには含めない。

## 変更内容 (Changes)

- Add `events.required_video_fields_json` as a nullable `TEXT` column storing a JSON array of allow-listed VideoForm keys.
- Keep the field behind the existing `event.questions` edit permission.
- Do not expose the list through public API DTOs and do not add an index; the field is read with the existing event-row lookup.
- Selected events union their required keys. Slotted YouTube URL stays optional unless `youtube_url` is in the list.

## データ損失 (Data loss)

None. Existing events keep a `NULL` list and retain their current required-field behavior.

## ロールバック (Rollback)

No destructive rollback is provided. Restore from a verified D1 backup/manual schema procedure if rollback is required.

## 検証 (Validation)

- `npm run check:db-schema`
- `npm run check:db-migration`
- `npm run check:db-history`
- `src/lib/video/requiredVideoFields.test.mjs`
- typecheck and related unit tests
