-- Final DB reduction cleanup.
-- Canonical replacements:
-- - events.public_api_enabled replaces api_endpoints
-- - videos.score / videos.app_like_count replace video_stats
-- - event_staff_permissions replaces event_staff.permission_keys_json

DROP TABLE IF EXISTS api_endpoints;
DROP TABLE IF EXISTS video_stats;

ALTER TABLE event_staff DROP COLUMN permission_keys_json;
