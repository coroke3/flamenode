import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { xidWriteStack } from "../src/routes/xid/index.ts";
import { createXIdProfileRoutes } from "../src/routes/xid/profile.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
const USER = {
  id: "admin-1", name: "Admin", email: null, image: null,
  role: "user", is_banned: 0, active_x_user_id: null,
};

function setup({ linked = true, approved = true, onFirst } = {}) {
  const { db, sqlite, stats } = createAdminD1({ onFirst });
  seedBase(sqlite, { role: "user" });
  // Match the full CURRENT x_users fields missing from the minimal
  // shared admin fixture. The real schema already contains these columns.
  for (const column of ["profile_text", "portfolio_contact", "youtube_channel_url", "other_social_links"]) {
    sqlite.exec(`ALTER TABLE x_users ADD COLUMN ${column} TEXT`);
  }
  sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES ('x_one','Before',?)")
    .run(approved ? "approved" : "pending");
  if (linked) {
    sqlite.prepare("INSERT INTO x_user_account_links (auth_user_id,x_user_id) VALUES (?,?)")
      .run(USER.id, "x_one");
  }
  let sessionCalls = 0;
  const session = async (c, next) => {
    sessionCalls++;
    c.set("user", { ...USER });
    c.set("sessionState", "user");
    await next();
  };
  const app = new Hono();
  // Exercise isolated handlers through the real parent write stack, but NEVER
  // mount in public createXIdRoutes before S3 and independent review.
  app.route("/api/xid", createXIdProfileRoutes(xidWriteStack(session)));
  const send = (body = { x_user_id: "x_one", x_name: "After" }, origin = SITE) =>
    app.request(SITE + "/api/xid/x_one/profile", {
      method: "PATCH",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, { DB: db, NEXT_PUBLIC_SITE_URL: SITE });
  return { db, sqlite, stats, send, get sessionCalls() { return sessionCalls; } };
}

test("SA-102 isolated handler updates linked approved X with audit and atomic 3-target queue", async () => {
  const h = setup();
  const result = await h.send({
    x_user_id: "@X_ONE",
    x_name: "  Updated Creator  ",
    profile_text: " About us ",
    portfolio_contact: " contact@example.com ",
    youtube_channel_url: "https://example.com",
    other_social_links: JSON.stringify([{ type: "Email", url: "mail@example.com" }]),
  });
  assert.equal(result.status, 200, await result.text());
  const row = h.sqlite.prepare("SELECT * FROM x_users WHERE id = 'x_one'").get();
  assert.equal(row.x_name, "Updated Creator");
  assert.equal(row.profile_text, "About us");
  assert.equal(row.portfolio_contact, "contact@example.com");
  assert.equal(row.youtube_channel_url, "https://example.com/");
  assert.equal(row.other_social_links, JSON.stringify([{ type: "Email", url: "mailto:mail@example.com" }]));
  const audit = h.sqlite.prepare("SELECT * FROM audit_logs WHERE table_name='x_users'").get();
  assert.ok(audit, "strict x_users audit must commit atomically");
  assert.equal(audit.actor_user_id, USER.id);
  assert.equal(audit.actor_x_user_id, "x_one");
  assert.equal(JSON.parse(audit.before_json).x_name, "Before");
  assert.equal(JSON.parse(audit.after_json).x_name, "Updated Creator");
  const queued = h.sqlite.prepare("SELECT target_type, target_id FROM static_rebuild_queue").all();
  assert.deepEqual(queued.map(x => x.target_type).sort(), ["member_suggestions", "user", "users_index"]);
  assert.equal(h.stats.batches, 1, "profile update, strict audit and queue share one atomic batch");
});

test("SA-102 isolated handler blocks unlinked and unapproved X without mutation", async () => {
  for (const config of [{ linked: false }, { approved: false }]) {
    const h = setup(config);
    const res = await h.send();
    assert.equal(res.status, 403);
    assert.equal(h.sqlite.prepare("SELECT x_name FROM x_users WHERE id='x_one'").get().x_name, "Before");
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
    assert.equal(h.stats.batches, 0);
  }
});

test("SA-102 isolated handler denies cross-origin before session or database access", async () => {
  const h = setup();
  const res = await h.send({ x_user_id: "x_one" }, "https://evil.example");
  assert.equal(res.status, 403);
  assert.equal(h.sessionCalls, 0);
  assert.equal(h.stats.reads, 0);
  assert.equal(h.stats.batches, 0);
});

test("SA-102 isolated handler refuses bad JSON values before any write", async () => {
  const h = setup();
  for (const body of [
    { x_user_id: "x_other", x_name: "Injected" },
    { x_user_id: "x_one", youtube_channel_url: "javascript:alert(1)" },
    { x_user_id: "x_one", other_social_links: "{broken" },
  ]) {
    const res = await h.send(body);
    assert.equal(res.status, 400);
    assert.equal(h.stats.batches, 0);
  }
  assert.equal(h.sqlite.prepare("SELECT x_name FROM x_users WHERE id='x_one'").get().x_name, "Before");
});

test("SA-102 isolated handler rolls back queued changes and audit on stale CAS snapshot", async () => {
  let raced = false;
  const h = setup({ onFirst: (statement, sqlite) => {
    if (!raced && statement.includes("SELECT x.* FROM x_users x")) {
      raced = true;
      sqlite.prepare("UPDATE x_users SET x_name = 'Concurrent' WHERE id = 'x_one'").run();
    }
  } });
  const res = await h.send({ x_user_id: "x_one", x_name: "Stale" });
  assert.equal(raced, true, "test must perturb the authoritative row after its read");
  assert.equal(res.status, 409);
  assert.equal(h.sqlite.prepare("SELECT x_name FROM x_users WHERE id='x_one'").get().x_name, "Concurrent");
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
});

test("SA-102 isolated handler denies a linked-X revocation raced after authorization read", async () => {
  let revoked = false;
  const h = setup({ onFirst: (statement, sqlite) => {
    if (!revoked && statement.includes("SELECT x.* FROM x_users x")) {
      revoked = true;
      sqlite.prepare("DELETE FROM x_user_account_links WHERE auth_user_id = ? AND x_user_id = ?")
        .run(USER.id, "x_one");
    }
  } });
  const res = await h.send({ x_user_id: "x_one", x_name: "Must not persist" });
  assert.equal(revoked, true, "fixture must revoke the linked-X authority after the guarded read");
  assert.equal(res.status, 409);
  assert.equal(h.sqlite.prepare("SELECT x_name FROM x_users WHERE id = 'x_one'").get().x_name, "Before");
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
});

test("SA-102 isolated handler denies approval revocation raced after authorization read", async () => {
  let revoked = false;
  const h = setup({ onFirst: (statement, sqlite) => {
    if (!revoked && statement.includes("SELECT x.* FROM x_users x")) {
      revoked = true;
      sqlite.prepare("UPDATE x_users SET approval_status = 'rejected' WHERE id = ?").run("x_one");
    }
  } });
  const res = await h.send({ x_user_id: "x_one", x_name: "Must not persist" });
  assert.equal(revoked, true, "fixture must revoke approval after the authorized read");
  assert.equal(res.status, 409);
  assert.deepEqual(h.sqlite.prepare("SELECT x_name, approval_status FROM x_users WHERE id = 'x_one'").get(), {
    x_name: "Before", approval_status: "rejected",
  });
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
});

test("SA-102 isolated handler returns error without mutation when D1 pre-read fails", async () => {
  const h = setup({ onFirst: (statement) => {
    if (statement.includes("SELECT x.* FROM x_users x")) throw new Error("transient read failure");
  } });
  const res = await h.send({ x_user_id: "x_one", x_name: "Never" });
  assert.equal(res.status, 503);
  assert.equal(h.sqlite.prepare("SELECT x_name FROM x_users WHERE id = 'x_one'").get().x_name, "Before");
  assert.equal(h.stats.batches, 0);
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
});

test("SA-102 isolated handler rejects oversized bodies and does not mutate state", async () => {
  const h = setup();
  const res = await h.send({
    x_user_id: "x_one", x_name: "Overflow", profile_text: "A".repeat(70 * 1024),
  });
  assert.equal(res.status, 413);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.equal(h.sqlite.prepare("SELECT x_name FROM x_users WHERE id='x_one'").get().x_name, "Before");
  assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  assert.equal(h.stats.batches, 0);
});

test("SA-102 isolated handler never emits cacheable private profile responses", async () => {
  for (const config of [{ linked: false }, { approved: false }, {}]) {
    const h = setup(config);
    const res = await h.send();
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  }
});
