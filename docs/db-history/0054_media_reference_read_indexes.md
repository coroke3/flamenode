# 0054_media_reference_read_indexes

- Date: 2026-08-08
- Type: additive / index-only
- Data loss: none

## Purpose

D1 Query Insights showed that the public-media orphan/reference safety check repeatedly scanned `x_users`, `videos`, `events`, and `event_groups` when checking whether an R2 image URL is still referenced.

This migration adds partial equality indexes for the six nullable URL columns used by that safety query:

- `x_users.icon_url`
- `videos.creator_icon_url`
- `events.icon_url`
- `events.img_url`
- `event_groups.icon_url`
- `event_groups.img_url`

`static_artifacts.object_key` is already protected by the existing live-object unique index, so no additional index is added there.

## Behavior

No application behavior changes. The deletion path remains fail-closed and still verifies all reference sources before removing an R2 object. The trade-off is a small increase in index maintenance writes when these image URL columns are updated.

## Validation

After applying the migration, compare `EXPLAIN QUERY PLAN` for the media reference query and confirm the URL predicates use the new indexes instead of full table scans. Then verify D1 Query Insights rows-read before/after.
