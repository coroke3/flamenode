-- D1 rows_read optimization for public-media orphan/reference checks.
-- These columns are read with equality predicates before deleting an R2 object.
-- Partial indexes avoid indexing the overwhelmingly common NULL case.

CREATE INDEX IF NOT EXISTS x_users_icon_url_idx
  ON x_users(icon_url)
  WHERE icon_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS videos_creator_icon_url_idx
  ON videos(creator_icon_url)
  WHERE creator_icon_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_icon_url_idx
  ON events(icon_url)
  WHERE icon_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_img_url_idx
  ON events(img_url)
  WHERE img_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_groups_icon_url_idx
  ON event_groups(icon_url)
  WHERE icon_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_groups_img_url_idx
  ON event_groups(img_url)
  WHERE img_url IS NOT NULL;
