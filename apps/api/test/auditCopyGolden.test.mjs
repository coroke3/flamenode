// MIG-0617 U01: golden of every D1 batch the Hono write routes send through the audited
// mutation path (SA-004..008, SA-012..015, SA-036). Committed BEFORE the Option A copy is
// replaced by packages/server-core, and compared byte for byte AFTER: the snapshot holds the
// whitespace-normalised SQL text and the bind parameters of each batch statement (mutation,
// changes() assertion, queue UPSERT, audit INSERT, audit count assertion), the D1 read count,
// the HTTP status and body. Dates and ids are frozen, so the audit bytes are comparable.
// Regenerate only on purpose: FLAMENODE_UPDATE_GOLDEN=1 node --test apps/api/test/auditCopyGolden.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { adminEventRoutes } from "../src/routes/events/index.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";
import { createSqlite } from "./support/personalHarness.mjs";
import { atomicD1, chapterApp, seedChapterWorld } from "./support/chapterSeed.mjs";

const SNAPSHOT_URL = new URL("./auditCopyGolden.snapshot.json", import.meta.url);
const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", email: null, image: null, role: "admin", is_banned: 0, active_x_user_id: null };
const NOW_MS = 1_800_000_000_000;
const norm = (sql) => sql.replace(/\s+/g, " ").trim();

function freeze() {
  let n = 0;
  const originalNow = Date.now;
  const originalUuid = globalThis.crypto.randomUUID;
  Date.now = () => NOW_MS;
  globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  return () => {
    Date.now = originalNow;
    globalThis.crypto.randomUUID = originalUuid;
  };
}

/** Records every statement passed to d1.batch (also when the batch rejects). */
function recordBatches(d1) {
  const batches = [];
  const original = d1.batch.bind(d1);
  d1.batch = async (statements) => {
    batches.push(
      statements.map((s) => ({
        sql: norm(s._sql ?? s.__sql),
        params: [...(s._params ?? s.__params)],
      })),
    );
    return original(statements);
  };
  return batches;
}

function installCacheStub() {
  const previous = globalThis.caches;
  globalThis.caches = { default: { delete: async () => true } };
  return () => {
    globalThis.caches = previous;
  };
}

const VALID = { title: "T", body: "B", severity: "info", target_audience: "all", is_published: 1 };
const TEMPLATE = ["etmpl_1", "T", null, "ev-1", "{\"a\":1}", "admin-1", 10, 20];

function adminWorld({ onFirst, template = false, announcement = false, event } = {}) {
  const { db, sqlite, stats } = createAdminD1({ onFirst });
  seedBase(sqlite);
  sqlite.exec(`CREATE TABLE event_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, source_event_id TEXT, settings_json TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
  if (template) sqlite.prepare("INSERT INTO event_templates VALUES (?,?,?,?,?,?,?,?)").run(...TEMPLATE);
  if (announcement) sqlite.prepare("INSERT INTO announcements VALUES ('a1', 'Old', 'Body', 'info', 0, NULL, NULL, 'all', 'x', 50, 100)").run();
  if (event) seedEvent(sqlite, event);
  const hono = new Hono();
  hono.route("/api/admin", createAdminRoutes({
    session: async (c, next) => {
      c.set("user", ADMIN);
      c.set("sessionState", "user");
      await next();
    },
  }));
  hono.route("/api/admin", adminEventRoutes);
  const batches = recordBatches(db);
  const request = (method, path, body) =>
    hono.request(path, {
      method,
      headers: { "content-type": "application/json", Origin: SITE },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  return { sqlite, stats, batches, request };
}

function chapterWorld(as) {
  const sqlite = createSqlite();
  seedChapterWorld(sqlite);
  const d1 = atomicD1(sqlite);
  const batches = recordBatches(d1);
  return { sqlite, stats: d1.stats, batches, request: chapterApp(d1, as) };
}

const SNAP = (x) => ({ active_x_snapshot: x });
const CHAPTER = { chapter_time: "1:30", chapter_label: "Intro", note: "hello", visibility: "public" };
const BULK_CSV = "time,label,note,visibility\n0:10,A,first,public\n1:00,B,,private\n2:00,C,third\n3:00,D,\n4:00,E,five,private";

const raceOnFirst = (table, update) => {
  let armed = true;
  return (sql, q) => {
    if (armed && sql.includes(`FROM ${table}`)) {
      armed = false;
      q.prepare(update).run();
    }
  };
};

const SCENARIOS = [
  ["SA-004 create announcement", () => adminWorld(), (w) => w.request("POST", "/api/admin/announcements", { ...VALID, id: "a-new" })],
  ["SA-005 update announcement", () => adminWorld({ announcement: true }), (w) => w.request("PUT", "/api/admin/announcements/a1", { ...VALID, title: "New", base_updated_at: 100 })],
  [
    "SA-005 update announcement, race after preflight",
    () => adminWorld({ announcement: true, onFirst: raceOnFirst("announcements", "UPDATE announcements SET updated_at = 500 WHERE id = 'a1'") }),
    (w) => w.request("PUT", "/api/admin/announcements/a1", { ...VALID, title: "Lost", base_updated_at: 100 }),
  ],
  ["SA-006 delete announcement", () => adminWorld({ announcement: true }), (w) => w.request("DELETE", "/api/admin/announcements/a1")],
  ["SA-007 enable public API", () => adminWorld({ event: {} }), (w) => w.request("POST", "/api/admin/api-endpoints", { event_id: "ev-1" })],
  [
    "SA-008 disable public API",
    () => adminWorld({ event: { visibility_status: "archived", public_api_enabled: 1 } }),
    (w) => w.request("PATCH", "/api/admin/api-endpoints/ev-1", { public_api_enabled: "0" }),
  ],
  ["SA-036 delete event template", () => adminWorld({ template: true }), (w) => w.request("DELETE", "/api/admin/event-templates/etmpl_1")],
  [
    "SA-036 delete event template, CAS conflict",
    () => adminWorld({ template: true, onFirst: raceOnFirst("event_templates", "UPDATE event_templates SET name = 'changed' WHERE id = 'etmpl_1'") }),
    (w) => w.request("DELETE", "/api/admin/event-templates/etmpl_1"),
  ],
  ["SA-012 create chapter", () => chapterWorld("u_owner"), (w) => w.request("POST", "/api/videos/v_pub/chapters", { ...CHAPTER, ...SNAP("x_owner") })],
  ["SA-013 update chapter", () => chapterWorld("u_owner"), (w) => w.request("PUT", "/api/videos/chapters/ch_owner", { ...CHAPTER, chapter_label: "Changed" })],
  ["SA-014 delete chapter", () => chapterWorld("u_owner"), (w) => w.request("DELETE", "/api/videos/chapters/ch_owner")],
  [
    "SA-015 bulk chapters (5 audit rows, 2 audit chunks)",
    () => chapterWorld("u_admin"),
    (w) => w.request("POST", "/api/videos/v_pub/chapters/bulk", { csv: BULK_CSV, ...SNAP("x_admin") }),
  ],
];

async function capture() {
  const out = {};
  const originalError = console.error;
  console.error = () => {};
  try {
    for (const [name, build, act] of SCENARIOS) {
      const restoreCache = installCacheStub();
      const restore = freeze();
      try {
        const world = build();
        const res = await act(world);
        out[name] = {
          status: res.status,
          body: await res.json(),
          reads: world.stats.reads,
          batches: world.batches,
          audit_logs: world.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,
        };
      } finally {
        restore();
        restoreCache();
      }
    }
  } finally {
    console.error = originalError;
  }
  return out;
}

test("MIG-0617 golden: audited write batches (SQL text, params, reads, status, body) are unchanged", async () => {
  const actual = `${JSON.stringify(await capture(), null, 2)}\n`;
  if (process.env.FLAMENODE_UPDATE_GOLDEN === "1") {
    fs.writeFileSync(SNAPSHOT_URL, actual);
    return;
  }
  assert.equal(actual, fs.readFileSync(SNAPSHOT_URL, "utf8"));
});

test("MIG-0617 golden: every scenario ran at most one batch; committed ones wrote an audit row", async () => {
  const actual = await capture();
  assert.equal(Object.keys(actual).length, SCENARIOS.length);
  for (const [name, result] of Object.entries(actual)) {
    assert.ok(result.batches.length <= 1, `${name}: at most one D1 batch`);
    if (result.status === 200) assert.ok(result.audit_logs >= 1, `${name}: audit row committed`);
    else assert.equal(result.audit_logs, 0, `${name}: failed batch rolled back`);
  }
});
