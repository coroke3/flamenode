// node:sqlite backed D1 fake for admin mutation tests. batch() is atomic
// (BEGIN/ROLLBACK) like D1 batch; every statement runs through .all().
import { DatabaseSync } from "node:sqlite";

export const EVENT_COLUMNS = [
  "id", "title", "event_type", "explanation", "youtube_description_template",
  "required_video_fields_json", "icon_url", "img_url", "accent_color",
  "visibility_status", "allow_user_video_event_links", "allow_unslotted_posts",
  "allow_user_video_edits", "user_video_edit_permission_keys_json", "slot_type",
  "slot_visibility_mode", "start_time", "end_time", "entry_start_time",
  "entry_end_time", "created_at", "updated_at", "max_slots_per_video",
  "max_slot_reservation_groups_per_xid", "slot_interval_minutes",
  "review_settings", "editable_fields", "repeat_rules", "slot_part_gap_minutes",
  "parts_json", "public_api_enabled",
];

export const SCHEMA = `
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT, discord_id TEXT,
    role TEXT, is_banned INTEGER, is_tos_accepted INTEGER, accepted_terms_version_id TEXT,
    active_x_user_id TEXT);
  CREATE TABLE x_users (id TEXT PRIMARY KEY, x_name TEXT, icon_url TEXT, approval_status TEXT);
  CREATE TABLE x_user_account_links (auth_user_id TEXT, x_user_id TEXT);
  CREATE TABLE terms_versions (id TEXT PRIMARY KEY, severity TEXT, published_at INTEGER, updated_at INTEGER);
  CREATE TABLE user_tos_consents (id TEXT PRIMARY KEY, user_id TEXT, terms_version_id TEXT);
  CREATE TABLE system_settings (id TEXT PRIMARY KEY, operation_mode TEXT, disabled_features_json TEXT,
    cost_guard_exception_until INTEGER, cost_guard_exception_features_json TEXT,
    audit_normal_retention_days INTEGER, audit_restorable_retention_days INTEGER,
    audit_long_retention_days INTEGER, audit_max_payload_bytes INTEGER, audit_compact_after_days INTEGER,
    default_editable_fields TEXT, upcoming_editable_fields TEXT, cost_guard_reason TEXT,
    cost_guard_updated_by_user_id TEXT, cost_guard_updated_at INTEGER,
    audit_updated_by_auth_user_id TEXT, audit_updated_at INTEGER);
  CREATE TABLE audit_logs (id TEXT PRIMARY KEY, table_name TEXT, target_id TEXT, operation TEXT,
    before_json TEXT, after_json TEXT, changed_keys_json TEXT, inverse_patch_json TEXT,
    actor_user_id TEXT, actor_x_user_id TEXT, actor_snapshot_json TEXT, reason TEXT, context TEXT,
    retention_class TEXT, restore_strategy TEXT, restore_status TEXT, payload_size_bytes INTEGER,
    expires_at INTEGER, created_at INTEGER, restore_unavailable_reason_code TEXT,
    restore_unavailable_message TEXT);
  CREATE TABLE announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
    severity TEXT, is_published INTEGER, publish_at INTEGER, expire_at INTEGER, target_audience TEXT,
    created_by_user_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE static_rebuild_queue (id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
    reason TEXT, priority TEXT, status TEXT NOT NULL, attempt_count INTEGER, requested_by_user_id TEXT,
    created_at INTEGER, updated_at INTEGER);
  CREATE UNIQUE INDEX static_rebuild_queue_active ON static_rebuild_queue(target_type, target_id)
    WHERE status IN ('pending', 'processing');
  CREATE TABLE events (${EVENT_COLUMNS.map((c) => (c === "id" ? "id TEXT PRIMARY KEY" : c)).join(", ")});
`;

export function createAdminD1({ onFirst } = {}) {
  const stats = { reads: 0, batches: 0, prepares: 0 };
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(SCHEMA);
  const make = (sql, params) => ({
    _sql: sql,
    _params: params,
    first: async () => {
      stats.reads += 1;
      const row = sqlite.prepare(sql).get(...params) ?? null;
      if (onFirst) onFirst(sql, sqlite);
      return row;
    },
    all: async () => {
      stats.reads += 1;
      return { results: sqlite.prepare(sql).all(...params) };
    },
    run: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    // drizzle-orm/d1 reads (select().get()) go through raw(): column-ordered arrays.
    raw: async () => {
      stats.reads += 1;
      const prepared = sqlite.prepare(sql);
      prepared.setReturnArrays(true);
      try {
        return prepared.all(...params).map((row) => [...row]);
      } finally {
        prepared.setReturnArrays(false);
      }
    },
  });
  const db = {
    prepare: (sql) => {
      stats.prepares += 1;
      return { bind: (...params) => make(sql, params) };
    },
    batch: async (statements) => {
      stats.batches += 1;
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push({ results: sqlite.prepare(s._sql).all(...s._params) });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, sqlite, stats };
}

export function seedBase(sqlite, { role = "admin", settings = "normal" } = {}) {
  sqlite.prepare("INSERT INTO \"user\" (id, name, discord_id, role, is_banned, is_tos_accepted) VALUES ('admin-1', 'Admin', 'd-1', ?, 0, 1)").run(role);
  if (settings !== null) {
    sqlite.prepare("INSERT INTO system_settings (id, operation_mode, audit_normal_retention_days, audit_restorable_retention_days, audit_long_retention_days, audit_max_payload_bytes, audit_compact_after_days) VALUES ('default', ?, 30, 180, 365, 120000, 30)").run(settings);
  }
}

export function seedEvent(sqlite, overrides = {}) {
  const row = {
    id: "ev-1", title: "Event", event_type: "event", explanation: null, youtube_description_template: null,
    required_video_fields_json: null, icon_url: null, img_url: null, accent_color: null,
    visibility_status: "public", allow_user_video_event_links: 0, allow_unslotted_posts: 0,
    allow_user_video_edits: 0, user_video_edit_permission_keys_json: null, slot_type: "time",
    slot_visibility_mode: "public_name", start_time: 1000, end_time: 2000, entry_start_time: null,
    entry_end_time: null, created_at: 10, updated_at: 20, max_slots_per_video: 1,
    max_slot_reservation_groups_per_xid: null, slot_interval_minutes: 30, review_settings: null,
    editable_fields: null, repeat_rules: null, slot_part_gap_minutes: 15, parts_json: null,
    public_api_enabled: 0, ...overrides,
  };
  sqlite.prepare(`INSERT INTO events (${EVENT_COLUMNS.join(", ")}) VALUES (${EVENT_COLUMNS.map(() => "?").join(", ")})`).run(...EVENT_COLUMNS.map((c) => row[c]));
  return row;
}
