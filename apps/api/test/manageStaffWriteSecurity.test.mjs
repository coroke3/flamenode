// SEC-800 U03a: dedicated failure-path regressions. The existing
// manageStaffWriteRoutes suite is being edited by PR #436. Reuse its
// SQLite adapter and real route; do not duplicate the happy-path matrix.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { registerStaffWriteRoutes } from "../src/routes/manage/staffWrite.ts";
import { LAST_OWNER_ERROR } from "@flamenode/server-core/event/eventOwnership";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

const ADMIN = { id: "admin-1", name: "Admin", role: "admin", is_banned: 0 };
const MEMBER = { ...ADMIN, role: "user" };
const CANARY = "synthetic-private-provider-detail";
const GENERIC = "スタッフ情報の取得・保存に失敗しました。再読み込みしてお試しください。";
const upsert = { display_name: "Added", x_user_id: "added_user", permission_preset: "public_staff", reason: "staff update" };
const transfer = {
  from_staff_id: "s-owner", to_staff_id: "s-target",
  reason: "handover", confirm_text: "TRANSFER ev-1", self_confirm_text: "SELF CHANGE ev-1",
};
const csv = (preset = "public_staff") => ({
  reason: "CSV onboarding",
  rows: [{
    lineNumber: 2, display_name: "CSV Staff", x_user_id: "csv_staff",
    permission_preset: preset, permission_keys: [], is_public_staff: "0", public_role_label: "",
  }],
});

function setup({ user = ADMIN, fault, failQueue = false, failRouteDb = false } = {}) {
  const { db, sqlite, stats } = createAdminD1();
  seedBase(sqlite);
  seedEvent(sqlite);
  sqlite.exec(`
    ALTER TABLE x_user_account_links ADD COLUMN link_role TEXT;
    CREATE TABLE event_staff (
      id TEXT PRIMARY KEY, event_id TEXT, x_user_id TEXT, display_name TEXT,
      permission_preset TEXT, custom_permission_keys_json TEXT, is_public INTEGER,
      public_role_label TEXT, approved_by_auth_user_id TEXT, approved_at INTEGER,
      created_at INTEGER, updated_at INTEGER
    );
    INSERT INTO x_users (id, x_name, approval_status) VALUES ('owner_x', 'Owner', 'approved');
    INSERT INTO x_user_account_links (auth_user_id, x_user_id, link_role) VALUES ('admin-1', 'owner_x', 'owner');
    INSERT INTO event_staff (id, event_id, x_user_id, display_name, permission_preset, is_public, created_at, updated_at)
      VALUES ('s-owner', 'ev-1', 'owner_x', 'Owner', 'owner', 0, 1, 1);
  `);
  const count = (table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n;
  const before = () => ["event_staff", "x_users", "audit_logs", "static_rebuild_queue"].map(count);
  const initial = before();
  const receipt = {
    readFaults: 0, queueFaults: 0, routeFaults: 0,
    committedAtQueueFailure: null, committedAtRouteFailure: null,
  };
  const originalPrepare = db.prepare;
  db.prepare = (sql) => {
    if (fault?.match(sql)) {
      receipt.readFaults++;
      throw fault.error;
    }
    return originalPrepare(sql);
  };
  const originalBatch = db.batch;
  db.batch = async (statements) => {
    if (failQueue && statements.some((s) => /INSERT INTO static_rebuild_queue\s*\(/i.test(s._sql ?? ""))) {
      receipt.queueFaults++;
      receipt.committedAtQueueFailure = before();
      throw new Error(CANARY);
    }
    return originalBatch(statements);
  };
  const app = new Hono();
  app.onError(() => new Response("unexpected error boundary escape", { status: 500 }));
  app.use("*", async (c, next) => {
    c.set("user", user);
    c.set("db", drizzle(c.env.DB, { schema }));
    c.set("actorSnapshotJsonById", { [user.id]: JSON.stringify({ id: user.id, role: user.role }) });
    if (failRouteDb) {
      // Inject at the route's post-commit boundary, independently of whether
      // SEC-782's shared enqueue implementation catches its own diagnostics.
      const get = c.get.bind(c);
      c.get = (key) => {
        if (key === "db" && receipt.routeFaults === 0 &&
            count("audit_logs") === initial[2] + 2) {
          receipt.routeFaults++;
          receipt.committedAtRouteFailure = before();
          throw new Error(CANARY);
        }
        return get(key);
      };
    }
    await next();
  });
  registerStaffWriteRoutes(app);
  const send = (method, path, body) => app.request(
    "https://example.test/events/ev-1" + (path === "/owner-transfer" ? path : "/staff" + (path === "/" ? "" : path)),
    { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    { DB: db },
  );
  return { sqlite, stats, count, before, initial, receipt, send };
}

async function withThrowingDiagnostics(run) {
  const originalError = console.error;
  const originalWarn = console.warn;
  const errors = [];
  let warnings = 0;
  try {
    console.error = (...args) => { errors.push(args); throw new Error("diagnostic sink failed"); };
    // The shared enqueue warning may escape on current main or be swallowed
    // by SEC-782. Both outcomes must preserve the committed request.
    console.warn = () => { warnings++; throw new Error("warning sink failed"); };
    await run({ errors, warnings: () => warnings });
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

const staffRead = (sql) => /SELECT \* FROM event_staff WHERE event_id = \?/i.test(sql);
const transferRead = (sql) => /from\s+"event_staff"\s+where/i.test(sql);
const permissionRead = (sql) => /SELECT event_staff\.event_id AS event_id/i.test(sql);

test("SEC-800: provider prefix and throwing diagnostic cannot escape staff write failures", async () => {
  for (const [method, path, body, match, message] of [
    ["POST", "/", upsert, staffRead, "staff upsert unavailable"],
    ["PUT", "/s-owner", { ...upsert, staff_id: "s-owner" }, staffRead, "staff upsert unavailable"],
    ["DELETE", "/s-owner", { reason: "remove" }, staffRead, "staff delete unavailable"],
    ["POST", "/csv", csv(), staffRead, "CSV staff mutation unavailable"],
    ["POST", "/owner-transfer", transfer, transferRead, "owner transfer unavailable"],
  ]) {
    const s = setup({ fault: { match, error: new Error("確認 " + CANARY) } });
    try {
      await withThrowingDiagnostics(async ({ errors }) => {
        const result = await s.send(method, path, body);
        assert.equal(result.status, 503, await result.clone().text());
        assert.equal(result.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(await result.json(), { ok: false, message: GENERIC });
        assert.deepEqual(errors, [["[MIG-0654] " + message]]);
      });
      assert.equal(s.receipt.readFaults, 1, path);
      assert.equal(s.stats.batches, 0);
      assert.deepEqual(s.before(), s.initial);
    } finally {
      s.sqlite.close();
    }
  }
});

test("SEC-800: hostile error inspection and permission diagnostics fail closed", async () => {
  const getter = new Error();
  Object.defineProperty(getter, "message", { get() { throw new Error(CANARY); } });
  const proxy = new Proxy(new Error(), { getPrototypeOf() { throw new Error(CANARY); } });
  for (const [error, user, match, expectedLog] of [
    [getter, ADMIN, staffRead, "staff upsert unavailable"],
    [proxy, ADMIN, staffRead, "staff upsert unavailable"],
    [new Error(CANARY), MEMBER, permissionRead, "staff permission read failed"],
  ]) {
    const s = setup({ user, fault: { match, error } });
    try {
      await withThrowingDiagnostics(async ({ errors }) => {
        const result = await s.send("POST", "/", upsert);
        assert.equal(result.status, 503, await result.clone().text());
        assert.equal(result.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(await result.json(), { ok: false, message: GENERIC });
        assert.deepEqual(errors, [["[MIG-0654] " + expectedLog]]);
      });
      assert.equal(s.receipt.readFaults, 1);
      assert.equal(s.stats.batches, 0);
      assert.deepEqual(s.before(), s.initial);
    } finally {
      s.sqlite.close();
    }
  }
});

test("SEC-800: preserve exact trusted owner and confirmation messages, and CSV assignment denial", async () => {
  const admin = setup();
  try {
    const denied = await admin.send("POST", "/owner-transfer", { ...transfer, confirm_text: "TRANSFER other" });
    assert.equal(denied.status, 409, await denied.clone().text());
    assert.deepEqual(await denied.json(), { ok: false, message: "確認のため「TRANSFER ev-1」と入力してください。" });
    const last = await admin.send("DELETE", "/s-owner", { reason: "remove", confirm_text: "REMOVE SELF ev-1" });
    assert.equal(last.status, 409, await last.clone().text());
    assert.deepEqual(await last.json(), { ok: false, message: LAST_OWNER_ERROR });
    assert.deepEqual(admin.before(), admin.initial);
    assert.equal(admin.stats.batches, 0);
  } finally {
    admin.sqlite.close();
  }
  const member = setup({ user: MEMBER });
  try {
    const denied = await member.send("POST", "/csv", csv("xid_reviewer"));
    assert.equal(denied.status, 400, await denied.clone().text());
    assert.deepEqual(await denied.json(), { ok: false, message: "X ID確認権限は site admin 専用です。" });
    assert.deepEqual(member.before(), member.initial);
    assert.equal(member.stats.batches, 0);
  } finally {
    member.sqlite.close();
  }
});

test("SEC-800: SA-031 validates permission input before staff mutation for every preset", async () => {
  const unknown = "event.not_a_real_permission";
  const boundedMessage = "不正な権限キーです: " + unknown;
  const deniedCases = [
    ["POST", "/", { ...upsert, permission_keys: unknown }, boundedMessage],
    ["POST", "/", { ...upsert, permission_preset: "custom", permission_keys: "event.members, " + unknown }, boundedMessage],
    ["PUT", "/s-owner", { ...upsert, staff_id: "s-owner", permission_keys: unknown }, boundedMessage],
    ["POST", "/", { ...upsert, permission_keys: "x".repeat(100) }, "不正な権限キーです: " + "x".repeat(100)],
    ["POST", "/", { ...upsert, permission_keys: "x".repeat(101) }, "入力エラー"],
    ["POST", "/", { ...upsert, permission_keys: "event.members,".repeat(40) + unknown }, "入力エラー"],
  ];
  for (const [method, path, body, message] of deniedCases) {
    const s = setup({ fault: { match: staffRead, error: new Error(CANARY) } });
    try {
      await withThrowingDiagnostics(async ({ errors }) => {
        const result = await s.send(method, path, body);
        assert.equal(result.status, 400, await result.clone().text());
        assert.deepEqual(await result.json(), { ok: false, message });
        assert.equal(result.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(errors, []);
      });
      assert.equal(s.receipt.readFaults, 0);
      assert.equal(s.stats.batches, 0);
      assert.deepEqual(s.before(), s.initial);
    } finally {
      s.sqlite.close();
    }
  }
  // Valid aliases, duplicates, and valid long lists still reach preparation.
  // An identical-looking provider exception may not become an input error.
  for (const keys of ["videos.title, video.basics, videos.title", "event.members,".repeat(40)]) {
    const s = setup({ fault: { match: staffRead, error: new Error(boundedMessage) } });
    try {
      await withThrowingDiagnostics(async ({ errors }) => {
        const result = await s.send("POST", "/", { ...upsert, permission_keys: keys });
        assert.equal(result.status, 503, await result.clone().text());
        assert.deepEqual(await result.json(), { ok: false, message: GENERIC });
        assert.deepEqual(errors, [["[MIG-0654] staff upsert unavailable"]]);
      });
      assert.equal(s.receipt.readFaults, 1);
      assert.equal(s.stats.batches, 0);
      assert.deepEqual(s.before(), s.initial);
    } finally {
      s.sqlite.close();
    }
  }
});

test("SEC-800: CSV owner conflicts return local row-specific messages, not provider text", async () => {
  const s = setup();
  const existingOwner = { ...csv().rows[0], lineNumber: 3, x_user_id: "owner_x" };
  const existingMessage = "3行目: 代表者はCSVで変更できません。専用の代表者移譲操作を使用してください。";
  try {
    const newOwner = await s.send("POST", "/csv", csv("owner"));
    assert.equal(newOwner.status, 409, await newOwner.clone().text());
    assert.deepEqual(await newOwner.json(), {
      ok: false,
      message: "2行目: 代表者の追加・変更はCSVでは行えません。専用の代表者移譲操作を使用してください。",
    });
    for (const rows of [[existingOwner], [...csv().rows, existingOwner]]) {
      const result = await s.send("POST", "/csv", { reason: "CSV owner conflict", rows });
      assert.equal(result.status, 409, await result.clone().text());
      assert.equal(result.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await result.json(), { ok: false, message: existingMessage });
      assert.deepEqual(s.before(), s.initial);
      assert.equal(s.stats.batches, 0);
    }
  } finally {
    s.sqlite.close();
  }
  // Even the same exact text from a provider is not a trusted local outcome.
  const faulty = setup({ fault: { match: staffRead, error: new Error(existingMessage) } });
  try {
    await withThrowingDiagnostics(async ({ errors }) => {
      const result = await faulty.send("POST", "/csv", { reason: "CSV owner conflict", rows: [existingOwner] });
      assert.equal(result.status, 503, await result.clone().text());
      assert.deepEqual(await result.json(), { ok: false, message: GENERIC });
      assert.deepEqual(errors, [["[MIG-0654] CSV staff mutation unavailable"]]);
    });
    assert.equal(faulty.receipt.readFaults, 1);
    assert.equal(faulty.stats.batches, 0);
    assert.deepEqual(faulty.before(), faulty.initial);
  } finally {
    faulty.sqlite.close();
  }
});

test("SEC-800: projection and diagnostic failure after strict audit preserves original success", async () => {
  const expectedRouteLog = [["[MIG-0654] post-commit staff projection enqueue failed"]];
  for (const mode of ["queue", "route"]) {
    const s = setup({ failQueue: mode === "queue", failRouteDb: mode === "route" });
    try {
      await withThrowingDiagnostics(async ({ errors, warnings }) => {
        const result = await s.send("POST", "/", upsert);
        assert.equal(result.status, 200, await result.clone().text());
        assert.deepEqual(await result.json(), { ok: true, pendingPublicReflection: true });
        if (mode === "queue") {
          assert.equal(warnings(), 1);
          // Current main lets the failed shared warning escape to the route.
          // SEC-782 (#436) contains it. No duplicate/raw route logs in either
          // order; the independent route fault below always covers its catch.
          assert.deepEqual(errors, errors.length === 0 ? [] : expectedRouteLog);
        } else {
          assert.equal(warnings(), 0);
          assert.deepEqual(errors, expectedRouteLog);
        }
      });
      assert.equal(s.receipt.queueFaults, mode === "queue" ? 1 : 0);
      assert.equal(s.receipt.routeFaults, mode === "route" ? 1 : 0);
      const committed = mode === "queue"
        ? s.receipt.committedAtQueueFailure : s.receipt.committedAtRouteFailure;
      assert.deepEqual(committed, [
        s.initial[0] + 1, s.initial[1] + 1, s.initial[2] + 2, s.initial[3],
      ]);
      assert.deepEqual(s.before(), committed);
      assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff WHERE x_user_id='added_user'").get().n, 1);
      assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id='added_user'").get().n, 1);
    } finally {
      s.sqlite.close();
    }
  }
});
