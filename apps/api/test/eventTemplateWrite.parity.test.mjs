// MIG-0655 U02: SA-035 save-event-template parity and safety regressions.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { adminEventRoutes } from "../src/routes/events/index.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", email: null, image: null, role: "admin", is_banned: 0, active_x_user_id: null };
const fields = {
  id: "ev-1", event_type: "event", explanation: null, youtube_description_template: null,
  required_video_fields_json: null, icon_url: null, img_url: null, accent_color: null,
  allow_user_video_event_links: 1, allow_unslotted_posts: 0, allow_user_video_edits: 1,
  user_video_edit_permission_keys_json: null, max_slots_per_video: 2,
  max_slot_reservation_groups_per_xid: null, slot_interval_minutes: null,
  slot_part_gap_minutes: null, slot_type: null, slot_visibility_mode: null,
  parts_json: null, review_settings: null, editable_fields: null, repeat_rules: null,
};

function setup({ user = ADMIN, role = "admin", settings = "normal", seedEvent = true } = {}) {
  const { db, sqlite, stats } = createAdminD1();
  seedBase(sqlite, { role, settings });
  sqlite.exec(`
    CREATE TABLE event_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      source_event_id TEXT, settings_json TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY, event_type TEXT, explanation TEXT, youtube_description_template TEXT,
      required_video_fields_json TEXT, icon_url TEXT, img_url TEXT, accent_color TEXT,
      allow_user_video_event_links INTEGER NOT NULL, allow_unslotted_posts INTEGER NOT NULL,
      allow_user_video_edits INTEGER NOT NULL, user_video_edit_permission_keys_json TEXT,
      max_slots_per_video INTEGER NOT NULL, max_slot_reservation_groups_per_xid INTEGER,
      slot_interval_minutes INTEGER, slot_part_gap_minutes INTEGER, slot_type TEXT,
      slot_visibility_mode TEXT, parts_json TEXT, review_settings TEXT,
      editable_fields TEXT, repeat_rules TEXT
    );
    CREATE TABLE event_custom_questions (
      event_id TEXT NOT NULL, question_key TEXT NOT NULL, label TEXT NOT NULL,
      description TEXT, type TEXT NOT NULL, required INTEGER NOT NULL,
      options_json TEXT, placeholder TEXT, max_length INTEGER, sort_order INTEGER NOT NULL,
      is_active INTEGER NOT NULL, visibility TEXT NOT NULL
    );
  `);
  if (seedEvent) {
    const keys = Object.keys(fields);
    sqlite.prepare(`INSERT INTO events (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...Object.values(fields));
  }
  const app = new Hono();
  app.route("/api/admin", createAdminRoutes({
    session: async (c, next) => {
      c.set("user", user);
      c.set("sessionState", user ? "user" : "none");
      await next();
    },
  }));
  app.route("/api/admin", adminEventRoutes);
  const post = (value = { event_id: "ev-1", name: "Template", description: "Sample" }, options = {}) =>
    app.request("/api/admin/event-templates", {
      method: "POST",
      headers: { Origin: SITE, "Content-Type": "application/json", ...options.headers },
      body: options.body ?? JSON.stringify(value),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  return { sqlite, db, stats, post };
}
const rowCount = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;

test("SA-035 creates template snapshot and strict CREATE audit atomically", async () => {
  const s = setup();
  s.sqlite.prepare("INSERT INTO event_custom_questions VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("ev-1", "stage_permission", "Stage permission", "description", "textarea", 1, null, "hint", 1000, 1, 1, "review");
  const response = await s.post();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.templateId, /^etmpl_/);
  assert.equal(body.message, "テンプレートを保存しました。");
  const stored = s.sqlite.prepare("SELECT * FROM event_templates").get();
  assert.equal(stored.id, body.templateId);
  assert.equal(stored.name, "Template");
  assert.equal(stored.source_event_id, "ev-1");
  const snapshot = JSON.parse(stored.settings_json);
  assert.equal(snapshot.max_slot_reservation_groups_per_xid, 0);
  assert.equal(snapshot.slot_part_gap_minutes, 15);
  assert.equal(snapshot.custom_question_definitions[0].question_key, "stage_permission");
  assert.equal(JSON.parse(snapshot.video_form_settings_json).stage_permissions[0].id, "stage_permission");
  const audit = s.sqlite.prepare("SELECT * FROM audit_logs").all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].target_id, stored.id);
  assert.equal(audit[0].operation, "CREATE");
  assert.equal(audit[0].reason, "イベントテンプレートを保存");
  assert.deepEqual(JSON.parse(audit[0].after_json), stored);
});

test("SA-035 rejects missing event, invalid form, oversized JSON without mutations", async () => {
  const s = setup({ seedEvent: false });
  assert.equal((await s.post()).status, 404);
  assert.equal((await s.post({ event_id: "", name: "" })).status, 400);
  assert.equal((await s.post(null, { headers: { "Content-Length": "65537" }, body: "{}" })).status, 413);
  assert.equal(rowCount(s.sqlite, "event_templates"), 0);
  assert.equal(rowCount(s.sqlite, "audit_logs"), 0);
});

test("SA-035 rejects other origin, non-admin and maintenance before mutation", async () => {
  const cross = setup();
  assert.equal((await cross.post(undefined, { headers: { Origin: "https://evil.example" } })).status, 403);
  const nonAdmin = setup({ user: { ...ADMIN, role: "moderator" }, role: "moderator" });
  assert.equal((await nonAdmin.post()).status, 403);
  const maintenance = setup({ settings: "maintenance" });
  assert.equal((await maintenance.post()).status, 503);
  for (const s of [cross, nonAdmin, maintenance]) {
    assert.equal(rowCount(s.sqlite, "event_templates"), 0);
    assert.equal(rowCount(s.sqlite, "audit_logs"), 0);
  }
});

test("SA-035 audit failure does not leave a template row", async () => {
  const s = setup();
  s.sqlite.exec("DROP TABLE audit_logs");
  assert.equal((await s.post()).status, 500);
  assert.equal(rowCount(s.sqlite, "event_templates"), 0);
});
