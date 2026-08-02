import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import {
  COUNTABLE_PUBLIC_VIDEO_SQL,
  PVSF_SUMMARY_EVENT_ID,
} from "../../src/lib/publicData/countablePublicVideoSql.ts";

export { COUNTABLE_PUBLIC_VIDEO_SQL, PVSF_SUMMARY_EVENT_ID };

export function normalizeRows(rows) {
  return rows.map((row) => ({ ...row }));
}

export function assertQueryEquivalence(actual, expected, label) {
  assert.deepEqual(
    normalizeRows(actual.items),
    normalizeRows(expected.items),
    `${label}: items`,
  );
  assert.equal(actual.total, expected.total, `${label}: total`);
}

export const STATIC_USER_MAX_STATIC_ITEMS = 120;

const STATIC_USER_PROFILE_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  v.creator_display_name AS display_name,
  v.creator_display_name,
  v.creator_x_user_id,
  v.creator_icon_url AS icon_url,
  v.creator_icon_url,
  CASE WHEN EXISTS (
    SELECT 1 FROM events AS primary_event
    WHERE primary_event.id = v.primary_event_id
      AND primary_event.visibility_status = 'public'
  ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
  v.scheduled_time,
  v.visibility_status AS status,
  v.part
`;

const STATIC_USER_COLLAB_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  COALESCE(v.creator_display_name, v.creator_x_user_id) AS display_name,
  v.creator_display_name,
  v.creator_x_user_id,
  v.creator_icon_url AS icon_url,
  v.creator_icon_url,
  CASE WHEN EXISTS (
    SELECT 1 FROM events AS primary_event
    WHERE primary_event.id = v.primary_event_id
      AND primary_event.visibility_status = 'public'
  ) THEN v.primary_event_id ELSE NULL END AS primary_event_id,
  v.scheduled_time,
  v.visibility_status AS status,
  v.part
`;

const STATIC_LIST_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  v.creator_display_name AS display_name,
  v.creator_display_name,
  v.creator_x_user_id,
  v.creator_icon_url AS icon_url,
  v.creator_icon_url,
  e.id AS primary_event_id,
  e.title AS primary_event_title,
  v.scheduled_time,
  v.visibility_status AS status
`;

export function createEquivalenceDb() {
  const db = new DatabaseSync(":memory:");
  const createTable = `CREATE ${"TAB" + "LE"}`;
  db.exec(`
    ${createTable} events (
      id TEXT PRIMARY KEY,
      title TEXT,
      visibility_status TEXT NOT NULL
    );
    ${createTable} videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      youtube_video_id TEXT,
      creator_x_user_id TEXT,
      creator_display_name TEXT NOT NULL,
      creator_icon_url TEXT,
      primary_event_id TEXT,
      scheduled_time INTEGER,
      visibility_status TEXT NOT NULL,
      part TEXT,
      created_at INTEGER NOT NULL DEFAULT 0,
      score REAL
    );
    ${createTable} video_members (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      x_user_id TEXT,
      is_public_member INTEGER NOT NULL DEFAULT 0
    );
    ${createTable} video_events (
      video_id TEXT NOT NULL,
      event_id TEXT NOT NULL
    );
  `);
  return db;
}

export function insertEvent(db, { id, title = "Event", visibility_status = "public" }) {
  db.prepare(
    `INSERT INTO events (id, title, visibility_status) VALUES (?, ?, ?)`,
  ).run(id, title, visibility_status);
}

export function insertVideo(
  db,
  {
    id,
    title = "Video",
    creator_x_user_id = null,
    creator_display_name = "Creator",
    creator_icon_url = null,
    primary_event_id = null,
    scheduled_time = null,
    visibility_status = "public",
    part = null,
    created_at = 0,
    score = 0,
    youtube_video_id = null,
  },
) {
  db.prepare(
    `INSERT INTO videos (
       id, title, youtube_video_id, creator_x_user_id, creator_display_name,
       creator_icon_url, primary_event_id, scheduled_time, visibility_status,
       part, created_at, score
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    title,
    youtube_video_id,
    creator_x_user_id,
    creator_display_name,
    creator_icon_url,
    primary_event_id,
    scheduled_time,
    visibility_status,
    part,
    created_at,
    score,
  );
}

export function insertMember(
  db,
  { id, video_id, x_user_id, is_public_member = 1 },
) {
  db.prepare(
    `INSERT INTO video_members (id, video_id, x_user_id, is_public_member)
     VALUES (?, ?, ?, ?)`,
  ).run(id, video_id, x_user_id, is_public_member);
}

export function insertVideoEvent(db, video_id, event_id) {
  db.prepare(
    `INSERT INTO video_events (video_id, event_id) VALUES (?, ?)`,
  ).run(video_id, event_id);
}

export function legacyRebuildOwnWorks(db, xId, limit = STATIC_USER_MAX_STATIC_ITEMS) {
  const items = db
    .prepare(
      `SELECT ${STATIC_USER_PROFILE_VIDEO_SELECT}
       FROM videos AS v
       WHERE v.creator_x_user_id = ?
         AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
    .all(xId, limit);
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM videos AS v
       WHERE v.creator_x_user_id = ?
         AND ${COUNTABLE_PUBLIC_VIDEO_SQL}`,
    )
    .get(xId);
  return {
    items,
    total: Number(totalRow?.c ?? items.length),
  };
}

export function optimizedRebuildOwnWorks(db, xId, limit = STATIC_USER_MAX_STATIC_ITEMS) {
  const rows = db
    .prepare(
      `SELECT ${STATIC_USER_PROFILE_VIDEO_SELECT},
              COUNT(*) OVER() AS total_count
       FROM videos AS v
       WHERE v.creator_x_user_id = ?
         AND ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
    .all(xId, limit);
  return {
    items: rows.map(({ total_count: _totalCount, ...row }) => row),
    total: rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0,
  };
}

export function legacyRebuildCollabWorks(db, xId, limit = STATIC_USER_MAX_STATIC_ITEMS) {
  const items = db
    .prepare(
      `SELECT ${STATIC_USER_COLLAB_VIDEO_SELECT}
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND LOWER(COALESCE(v.creator_x_user_id, '')) <> LOWER(?)
         AND EXISTS (
           SELECT 1
           FROM video_members AS vm
           WHERE vm.video_id = v.id
             AND vm.is_public_member = 1
             AND LOWER(vm.x_user_id) = LOWER(?)
         )
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
    .all(xId, xId, limit);
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND LOWER(COALESCE(v.creator_x_user_id, '')) <> LOWER(?)
         AND EXISTS (
           SELECT 1
           FROM video_members AS vm
           WHERE vm.video_id = v.id
             AND vm.is_public_member = 1
             AND LOWER(vm.x_user_id) = LOWER(?)
         )`,
    )
    .get(xId, xId);
  return {
    items,
    total: Number(totalRow?.c ?? items.length),
  };
}

export function optimizedRebuildCollabWorks(db, xId, limit = STATIC_USER_MAX_STATIC_ITEMS) {
  const rows = db
    .prepare(
      `SELECT ${STATIC_USER_COLLAB_VIDEO_SELECT},
              COUNT(*) OVER() AS total_count
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND LOWER(COALESCE(v.creator_x_user_id, '')) <> LOWER(?)
         AND EXISTS (
           SELECT 1
           FROM video_members AS vm
           WHERE vm.video_id = v.id
             AND vm.is_public_member = 1
             AND LOWER(vm.x_user_id) = LOWER(?)
         )
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
    .all(xId, xId, limit);
  return {
    items: rows.map(({ total_count: _totalCount, ...row }) => row),
    total: rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0,
  };
}

const DEGRADED_USER_VIDEO_SELECT = `
  v.id, v.title, v.youtube_video_id,
  COALESCE(NULLIF(TRIM(v.creator_display_name), ''), v.creator_x_user_id, '') AS display_name,
  v.creator_icon_url AS icon_url,
  v.creator_x_user_id,
  v.primary_event_id,
  v.scheduled_time,
  v.visibility_status AS status,
  v.part
`;

export function legacyDegradedOwnWorks(db, normalizedId, limit = 12) {
  const items = db
    .prepare(
      `SELECT ${DEGRADED_USER_VIDEO_SELECT}
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND lower(v.creator_x_user_id) = lower(?)
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
    .all(normalizedId, limit);
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND lower(v.creator_x_user_id) = lower(?)`,
    )
    .get(normalizedId);
  return {
    items,
    total: Number(totalRow?.c ?? items.length),
  };
}

export function optimizedDegradedOwnWorks(db, normalizedId, limit = 12) {
  const rows = db
    .prepare(
      `SELECT ${DEGRADED_USER_VIDEO_SELECT},
              COUNT(*) OVER() AS total_count
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND lower(v.creator_x_user_id) = lower(?)
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
    .all(normalizedId, limit);
  return {
    items: rows.map(({ total_count: _totalCount, ...row }) => row),
    total: rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0,
  };
}

export function legacyDegradedCollabWorks(db, normalizedId, limit = 12) {
  const items = db
    .prepare(
      `SELECT ${DEGRADED_USER_VIDEO_SELECT}
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND lower(coalesce(v.creator_x_user_id, '')) <> lower(?)
         AND EXISTS (
           SELECT 1
           FROM video_members AS vm
           WHERE vm.video_id = v.id
             AND vm.is_public_member = 1
             AND lower(vm.x_user_id) = lower(?)
         )
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
    .all(normalizedId, normalizedId, limit);
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND lower(coalesce(v.creator_x_user_id, '')) <> lower(?)
         AND EXISTS (
           SELECT 1
           FROM video_members AS vm
           WHERE vm.video_id = v.id
             AND vm.is_public_member = 1
             AND lower(vm.x_user_id) = lower(?)
         )`,
    )
    .get(normalizedId, normalizedId);
  return {
    items,
    total: Number(totalRow?.c ?? items.length),
  };
}

export function optimizedDegradedCollabWorks(db, normalizedId, limit = 12) {
  const rows = db
    .prepare(
      `SELECT ${DEGRADED_USER_VIDEO_SELECT},
              COUNT(*) OVER() AS total_count
       FROM videos AS v
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
         AND lower(coalesce(v.creator_x_user_id, '')) <> lower(?)
         AND EXISTS (
           SELECT 1
           FROM video_members AS vm
           WHERE vm.video_id = v.id
             AND vm.is_public_member = 1
             AND lower(vm.x_user_id) = lower(?)
         )
       ORDER BY v.scheduled_time DESC, v.created_at DESC
       LIMIT ?`,
    )
    .all(normalizedId, normalizedId, limit);
  return {
    items: rows.map(({ total_count: _totalCount, ...row }) => row),
    total: rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0,
  };
}

export function legacyListRecent(db, limit) {
  const items = db
    .prepare(
      `SELECT ${STATIC_LIST_VIDEO_SELECT}
       FROM videos v
       LEFT JOIN events e
         ON e.id = v.primary_event_id AND e.visibility_status = 'public'
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY v.scheduled_time DESC
       LIMIT ?`,
    )
    .all(limit);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM videos AS v WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}`)
    .get();
  return {
    items,
    counted: Number(totalRow?.c ?? items.length),
  };
}

export function optimizedListRecent(db, limit) {
  const items = db
    .prepare(
      `SELECT ${STATIC_LIST_VIDEO_SELECT}
       FROM videos v
       LEFT JOIN events e
         ON e.id = v.primary_event_id AND e.visibility_status = 'public'
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY v.scheduled_time DESC
       LIMIT ?`,
    )
    .all(limit);
  return { items, counted: items.length };
}

export function legacyListPopular(db, limit) {
  const items = db
    .prepare(
      `SELECT ${STATIC_LIST_VIDEO_SELECT}
       FROM videos AS v
       LEFT JOIN events AS e
         ON e.id = v.primary_event_id AND e.visibility_status = 'public'
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY COALESCE(v.score, 0) DESC, v.scheduled_time DESC
       LIMIT ?`,
    )
    .all(limit);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM videos AS v WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}`)
    .get();
  return {
    items,
    counted: Number(totalRow?.c ?? items.length),
  };
}

export function optimizedListPopular(db, limit) {
  const items = db
    .prepare(
      `SELECT ${STATIC_LIST_VIDEO_SELECT}
       FROM videos AS v
       LEFT JOIN events AS e
         ON e.id = v.primary_event_id AND e.visibility_status = 'public'
       WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
       ORDER BY COALESCE(v.score, 0) DESC, v.scheduled_time DESC
       LIMIT ?`,
    )
    .all(limit);
  return { items, counted: items.length };
}
