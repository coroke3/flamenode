// MIG-0602 U02: additional write-guard cases requested in the U01 review
// (consent edge cases, origin normalization, fail-closed site URL wiring).
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { DatabaseSync } from "node:sqlite";
import { writeGuardMiddleware } from "../src/middleware/writeOrigin.ts";

const SITE_URL = "https://app.flamenode.example";
const admin = {
  id: "u-1",
  name: "Admin",
  email: null,
  image: null,
  role: "admin",
  is_banned: 0,
  active_x_user_id: null,
};

function makeApp({ db, siteUrl = () => SITE_URL, allowLocalPreview = () => false }) {
  const app = new Hono();
  app.use("/api/admin/*", (c, next) => {
    c.set("user", admin);
    return next();
  });
  app.use("/api/admin/*", writeGuardMiddleware({ loadSiteUrl: siteUrl, allowLocalPreview }));
  app.post("/api/admin/me", (c) => c.json({ ok: true }));
  return { app, env: { DB: db } };
}

function cannedDb(row) {
  return {
    prepare() {
      return { bind: () => ({ first: async () => row, all: async () => ({ results: [] }) }) };
    },
  };
}
const CLEAN = cannedDb({ is_tos_accepted: 1, terms_reaccept_required: 0 });

function post(app, env, origin) {
  const headers = origin === undefined ? {} : { Origin: origin };
  return app.request("/api/admin/me", { method: "POST", headers }, env);
}

// --- origin normalization at middleware level (CURRENT origin.ts rules) ---

test("origin: literal 'null' Origin -> 403 invalid_origin", async () => {
  const { app, env } = makeApp({ db: CLEAN });
  const res = await post(app, env, "null");
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "invalid_origin");
});

test("origin: uppercase host is normalized -> passes", async () => {
  const { app, env } = makeApp({ db: CLEAN });
  assert.equal((await post(app, env, "https://APP.FlameNode.example")).status, 200);
});

test("origin: default :443 port is normalized -> passes", async () => {
  const { app, env } = makeApp({ db: CLEAN });
  assert.equal((await post(app, env, "https://app.flamenode.example:443")).status, 200);
});

test("origin: non-default port / path-bearing origin -> 403 invalid_origin", async () => {
  const { app, env } = makeApp({ db: CLEAN });
  for (const origin of ["https://app.flamenode.example:8443", "https://app.flamenode.example/path", "https://app.flamenode.example/", "http://app.flamenode.example"]) {
    const res = await post(app, env, origin);
    // "/" alone is a valid origin serialization for configuredHttpOrigin (pathname "/").
    if (origin.endsWith("example/")) {
      assert.equal(res.status, 200, origin);
    } else {
      assert.equal(res.status, 403, origin);
      assert.equal((await res.json()).reason, "invalid_origin", origin);
    }
  }
});

// --- site URL wiring (fail closed) ---

test("site URL: localhost SITE_URL with allowLocalPreview=false -> 503 origin_verification_unavailable", async () => {
  const { app, env } = makeApp({ db: CLEAN, siteUrl: () => "http://localhost:3000" });
  const res = await post(app, env, "http://localhost:3000");
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "origin_verification_unavailable");
});

test("site URL: localhost SITE_URL with allowLocalPreview=true -> same origin passes", async () => {
  const { app, env } = makeApp({ db: CLEAN, siteUrl: () => "http://localhost:3000", allowLocalPreview: () => true });
  assert.equal((await post(app, env, "http://localhost:3000")).status, 200);
});

test("site URL: loadSiteUrl throws -> 503 origin_verification_unavailable", async () => {
  const { app, env } = makeApp({
    db: CLEAN,
    siteUrl: () => {
      throw new Error("env unavailable");
    },
  });
  const res = await post(app, env, SITE_URL);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "origin_verification_unavailable");
});

// --- consent edge cases through the real raw-D1 CASE SQL ---

function tosDb({ accepted = null, consents = [], terms }) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, is_tos_accepted INTEGER, accepted_terms_version_id TEXT, discord_id TEXT, name TEXT, image TEXT, active_x_user_id TEXT);
    CREATE TABLE x_users (id TEXT PRIMARY KEY, x_name TEXT, icon_url TEXT, approval_status TEXT);
    CREATE TABLE terms_versions (id TEXT PRIMARY KEY, severity TEXT, published_at INTEGER, updated_at INTEGER);
    CREATE TABLE user_tos_consents (id TEXT PRIMARY KEY, user_id TEXT, terms_version_id TEXT);
  `);
  sqlite.prepare("INSERT INTO user (id, is_tos_accepted, accepted_terms_version_id) VALUES ('u-1', 1, ?)").run(accepted);
  sqlite.prepare("INSERT INTO user (id, is_tos_accepted) VALUES ('u-2', 1)").run();
  for (const t of terms) {
    sqlite.prepare("INSERT INTO terms_versions VALUES (?, ?, ?, ?)").run(t.id, t.severity, t.published_at, t.updated_at);
  }
  consents.forEach((c, i) => {
    sqlite.prepare("INSERT INTO user_tos_consents VALUES (?, ?, ?)").run("c-" + i, c.user_id, c.terms_version_id);
  });
  return {
    prepare(sql) {
      return {
        bind(...params) {
          const stmt = sqlite.prepare(sql);
          return { first: async () => stmt.get(...params) ?? null, all: async () => ({ results: stmt.all(...params) }) };
        },
      };
    },
  };
}
const OLD = { id: "v-old", severity: "major", published_at: 100, updated_at: 100 };
const NEW = { id: "v-new", severity: "major", published_at: 200, updated_at: 200 };

test("consent: only to an older major -> 403 tos_reaccept_required", async () => {
  const db = tosDb({ terms: [OLD, NEW], consents: [{ user_id: "u-1", terms_version_id: "v-old" }] });
  const { app, env } = makeApp({ db });
  const res = await post(app, env, SITE_URL);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "tos_reaccept_required");
});

test("consent: another user's consent to the latest major does not count -> 403", async () => {
  const db = tosDb({ terms: [OLD, NEW], consents: [{ user_id: "u-2", terms_version_id: "v-new" }] });
  const { app, env } = makeApp({ db });
  const res = await post(app, env, SITE_URL);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "tos_reaccept_required");
});

test("consent: accepted a version published after the latest major -> passes", async () => {
  const later = { id: "v-later", severity: "minor", published_at: 300, updated_at: 300 };
  const db = tosDb({ accepted: "v-later", terms: [OLD, NEW, later] });
  const { app, env } = makeApp({ db });
  assert.equal((await post(app, env, SITE_URL)).status, 200);
});

test("consent: mirror points to an unpublished version -> 403 tos_reaccept_required", async () => {
  const draft = { id: "v-draft", severity: "minor", published_at: null, updated_at: 300 };
  const db = tosDb({ accepted: "v-draft", terms: [OLD, NEW, draft] });
  const { app, env } = makeApp({ db });
  const res = await post(app, env, SITE_URL);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "tos_reaccept_required");
});
