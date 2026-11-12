// MIG-0731 U03b: test-only mounting; production admin router stays unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import {
  adminModerationCaseOnlyRoutes, parseCaseOnlyResolution,
} from "../src/routes/admin/moderation.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";
import { readFile } from "node:fs/promises";

const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", role: "admin", is_banned: 0,
  active_x_user_id: null, email: null, image: null };
function setup({ actor = ADMIN, mode = "normal", onFirst } = {}) {
  const { db, sqlite, stats } = createAdminD1({ onFirst });
  sqlite.exec([
    "CREATE TABLE videos (id TEXT PRIMARY KEY);",
    "CREATE TABLE video_moderation_cases (",
    "id TEXT PRIMARY KEY, video_id TEXT NOT NULL, case_type TEXT NOT NULL,",
    "status TEXT NOT NULL, public_reason TEXT, private_note TEXT, due_at INTEGER,",
    "locked_until INTEGER, attempt_count INTEGER NOT NULL DEFAULT 0,",
    "related_x_user_id TEXT, created_by_user_id TEXT, resolved_by_user_id TEXT,",
    "created_at INTEGER NOT NULL, resolved_at INTEGER);",
  ].join(" "));
  seedBase(sqlite, { role: actor?.role ?? "admin", settings: mode });
  sqlite.prepare("INSERT INTO videos (id) VALUES ('v1')").run();
  sqlite.prepare([
    "INSERT INTO video_moderation_cases",
    "(id,video_id,case_type,status,public_reason,private_note,created_at)",
    "VALUES ('c1','v1','rights','open','reason','existing',1234)",
  ].join(" ")).run();
  const parent = createAdminRoutes({
    session: async (c, next) => {
      c.set("user", actor);
      c.set("sessionState", actor ? "user" : "none");
      await next();
    },
  });
  parent.route("/moderation", adminModerationCaseOnlyRoutes);
  const app = new Hono();
  app.route("/api/admin", parent);
  const request = (body, origin = SITE) =>
    app.request("/api/admin/moderation/c1/status", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  const audits = () => sqlite.prepare("SELECT * FROM audit_logs").all();
  return { sqlite, stats, request, audits };
}

test("MIG-0731 U03b parser rejects visibility changes rather than skipping safety side effects", () => {
  assert.equal(parseCaseOnlyResolution({ status: "open" }).status, 400);
  assert.deepEqual(parseCaseOnlyResolution({ status: " resolved ", private_note: " new " }), {
    ok: true, value: { status: "resolved", private_note: "new" },
  });
  assert.equal(parseCaseOnlyResolution({ status: "resolved", video_status: "private" }).status, 501);
  assert.equal(parseCaseOnlyResolution({ status: "resolved", video_status: "invalid" }).status, 501);
  assert.equal(parseCaseOnlyResolution({ status: "resolved", video_status: 0 }).status, 400);
  assert.equal(parseCaseOnlyResolution({ status: "resolved", private_note: [] }).status, 400);
  assert.equal(parseCaseOnlyResolution({ status: "resolved", private_note: "x".repeat(3000) }).value.private_note.length, 2000);
});
test("MIG-0731 U03b request denied on origin, auth role, or CostGuard before mutation", async () => {
  for (const [opts, expected] of [
    [{ actor: null }, 401],
    [{ actor: { ...ADMIN, role: "moderator" } }, 403],
    [{ mode: "maintenance" }, 503],
  ]) {
    const state = setup(opts);
    const res = await state.request({ status: "resolved" });
    assert.equal(res.status, expected);
    assert.equal(state.sqlite.prepare("SELECT status FROM video_moderation_cases").get().status, "open");
    assert.equal(state.audits().length, 0);
  }
  const state = setup();
  const denied = await state.request({ status: "resolved" }, "https://evil.invalid");
  assert.equal(denied.status, 403);
  assert.equal(state.audits().length, 0);
});
test("MIG-0731 U03b one case-only transition yields CAS update and strict audit in atomic batch", async () => {
  const state = setup();
  const response = await state.request({ status: "resolved", private_note: "new note", video_status: "" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: true, message: "case を更新しました。" });
  const row = state.sqlite.prepare("SELECT * FROM video_moderation_cases").get();
  assert.equal(row.status, "resolved");
  assert.equal(row.private_note, "new note");
  assert.equal(row.resolved_by_user_id, "admin-1");
  assert.equal(state.audits().length, 1);
  assert.equal(state.audits()[0].context, "admin_moderation_update");
  assert.equal(state.audits()[0].retention_class, "long_audit");
  assert.equal(JSON.parse(state.audits()[0].before_json).status, "open");
  assert.equal(Object.hasOwn(JSON.parse(state.audits()[0].before_json), "_video_exists"), false,
    "derived existence flag must never pollute audit snapshots or CAS");
  assert.equal(JSON.parse(state.audits()[0].after_json).status, "resolved");
  assert.equal(state.stats.batches, 1);
  const repeat = await state.request({ status: "resolved" });
  assert.equal(repeat.status, 200);
  assert.equal(state.audits().length, 1, "idempotent update must not add an audit entry");
  const conflict = await state.request({ status: "rejected" });
  assert.equal(conflict.status, 409);
  assert.equal(state.audits().length, 1);
});
test("MIG-0731 U03b never writes on video change, invalid status, missing video", async () => {
  const state = setup();
  assert.equal((await state.request({ status: "resolved", video_status: "public" })).status, 501);
  assert.equal((await state.request({ status: "open" })).status, 400);
  assert.equal(state.audits().length, 0);
  state.sqlite.prepare("DELETE FROM videos WHERE id='v1'").run();
  assert.equal((await state.request({ status: "resolved" })).status, 404);
  assert.equal(state.sqlite.prepare("SELECT status FROM video_moderation_cases").get().status, "open");
  assert.equal(state.audits().length, 0);
});
test("MIG-0731 U03b stale CAS rolls back update and audit", async () => {
  let modified = false;
  const state = setup({ onFirst: (query, sqlite) => {
    if (!modified && /FROM video_moderation_cases c/.test(query)) {
      modified = true;
      sqlite.prepare("UPDATE video_moderation_cases SET private_note = 'concurrent' WHERE id='c1'").run();
    }
  } });
  const res = await state.request({ status: "resolved", private_note: "attempt" });
  assert.equal(res.status, 409, await res.clone().text());
  const caseRow = state.sqlite.prepare("SELECT status, private_note FROM video_moderation_cases").get();
  assert.equal(caseRow.status, "open");
  assert.equal(caseRow.private_note, "concurrent");
  assert.equal(state.audits().length, 0);
});
test("MIG-0731 U03b candidate is not mounted in production admin routes", async () => {
  const source = await readFile(new URL("../src/routes/admin/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /adminModerationCaseOnlyRoutes/);
});

test("MIG-0731 U03b reads case and video existence using one bounded D1 statement", async () => {
  const statements = [];
  const state = setup({ onFirst: (statement) => statements.push(statement) });
  const response = await state.request({ status: "rejected", private_note: "merged read" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(statements.filter(s => s.includes("FROM video_moderation_cases c LEFT JOIN videos v")).length, 1);
  assert.equal(statements.filter(s => s.includes("SELECT id FROM videos")).length, 0);
});
