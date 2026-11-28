// SEC-800 U03a: dedicated failure-path regressions. The existing
// manageStaffWriteRoutes suite is being edited by PR #436. Reuse its
// SQLite adapter and real route; do not duplicate the happy-path matrix.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import navigation from "next/navigation.js";
import { EventStaffCsvBodySchema } from "@flamenode/contracts";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { registerStaffWriteRoutes } from "../src/routes/manage/staffWrite.ts";
import {
  assertActorMayAssignOwner,
  LAST_OWNER_ERROR,
  transferEventOwnership,
} from "@flamenode/server-core/event/eventOwnership";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

// Native Node ESM requires the explicit CommonJS package entry.
const { redirect, unstable_rethrow } = navigation;

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

function setup({ user = ADMIN, fault, failQueue = false, failRouteDb = false, routeDbError, beforeTransferBatch } = {}) {
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
    readFaults: 0, queueFaults: 0, routeFaults: 0, transferInterleavings: 0,
    committedAtQueueFailure: null, committedAtRouteFailure: null,
  };
  const originalPrepare = db.prepare;
  db.prepare = (sql) => {
    if (!fault?.match(sql)) return originalPrepare(sql);
    if (fault.readMethod) {
      // A D1 failure can also reject the bound statement's read promise.
      const prepared = originalPrepare(sql);
      return {
        ...prepared,
        bind: (...params) => {
          const bound = prepared.bind(...params);
          return {
            ...bound,
            [fault.readMethod]: async () => {
              receipt.readFaults++;
              throw fault.error;
            },
          };
        },
      };
    }
    receipt.readFaults++;
    throw fault.error;
  };
  const originalBatch = db.batch;
  db.batch = async (statements) => {
    // Simulate a competing committed write after transfer reads but before
    // the original atomic mutation/audit batch. Never intercept reads or queue.
    if (beforeTransferBatch && receipt.transferInterleavings === 0 &&
        statements.some((s) => /UPDATE\s+event_staff\s+SET\s+permission_preset\s*=\s*CASE/i.test(s._sql ?? ""))) {
      receipt.transferInterleavings++;
      beforeTransferBatch(sqlite);
    }
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
    if (failRouteDb || routeDbError !== undefined) {
      // Inject directly at the route's context boundary. The pre-write fault
      // bypasses staffPreparationRead; the post-commit fault remains independent
      // of whether SEC-782's shared enqueue catches its own diagnostics.
      const get = c.get.bind(c);
      c.get = (key) => {
        if (key === "db" && receipt.routeFaults === 0) {
          if (routeDbError !== undefined) {
            receipt.routeFaults++;
            throw routeDbError;
          }
          if (failRouteDb && count("audit_logs") === initial[2] + 2) {
            receipt.routeFaults++;
            receipt.committedAtRouteFailure = before();
            throw new Error(CANARY);
          }
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
  return { db, sqlite, stats, count, before, initial, receipt, send };
}

async function withThrowingDiagnostics(run) {
  const originalError = console.error;
  const originalWarn = console.warn;
  const errors = [];
  const warningArgs = [];
  try {
    console.error = (...args) => { errors.push(args); throw new Error("diagnostic sink failed"); };
    // SEC-782 is now merged: retain the exact warning payload as well as count.
    console.warn = (...args) => { warningArgs.push(args); throw new Error("warning sink failed"); };
    await run({ errors, warnings: () => warningArgs.length, warningArgs });
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

test("SEC-800: direct preparation reads never classify provider text as a domain conflict", async () => {
  const singleXRead = (sql) => /SELECT id FROM x_users WHERE id = \? LIMIT 1/i.test(sql);
  const csvXRead = (sql) => /SELECT id FROM x_users WHERE id IN \(/i.test(sql);
  for (const [method, path, body, match, readMethod, log] of [
    ["POST", "/", upsert, staffRead, "all", "staff upsert unavailable"],
    ["PUT", "/s-owner", { ...upsert, staff_id: "s-owner" }, staffRead, "all", "staff upsert unavailable"],
    ["POST", "/", upsert, singleXRead, "first", "staff upsert unavailable"],
    ["PUT", "/s-owner", { ...upsert, staff_id: "s-owner" }, singleXRead, "first", "staff upsert unavailable"],
    ["POST", "/csv", csv(), staffRead, "all", "CSV staff mutation unavailable"],
    ["POST", "/csv", csv(), csvXRead, "all", "CSV staff mutation unavailable"],
    ["DELETE", "/s-owner", { reason: "remove" }, staffRead, "first", "staff delete unavailable"],
  ]) {
    for (const fault of [
      { match, error: new Error(LAST_OWNER_ERROR) },
      { match, readMethod, error: new Error("確認のため「REMOVE SELF ev-1」と入力してください。") },
    ]) {
      const s = setup({ fault });
      try {
        await withThrowingDiagnostics(async ({ errors }) => {
          const result = await s.send(method, path, body);
          assert.equal(result.status, 503, await result.clone().text());
          assert.equal(result.headers.get("cache-control"), "private, no-store");
          assert.deepEqual(await result.json(), { ok: false, message: GENERIC });
          assert.deepEqual(errors, [["[MIG-0654] " + log]]);
        });
        assert.equal(s.receipt.readFaults, 1);
        assert.equal(s.stats.batches, 0);
        assert.deepEqual(s.before(), s.initial);
      } finally {
        s.sqlite.close();
      }
    }
  }
});

test("SEC-800: hostile error inspection and permission diagnostics fail closed", async () => {
  let inspections = 0;
  const getter = new Error();
  Object.defineProperty(getter, "message", { get() { inspections++; throw new Error(CANARY); } });
  const proxy = new Proxy(new Error(), { getPrototypeOf() { inspections++; throw new Error(CANARY); } });
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
  // Direct preparation failures discard the exception before classification.
  assert.equal(inspections, 0);
  // The transfer handler accesses its db context inside the mutation catch,
  // outside staffPreparationRead. Both hostile values must actually reach the
  // guarded classifier, rather than being hidden by the direct-read wrapper.
  for (const error of [getter, proxy]) {
    const s = setup({ routeDbError: error });
    const previousInspections = inspections;
    try {
      await withThrowingDiagnostics(async ({ errors }) => {
        const result = await s.send("POST", "/owner-transfer", transfer);
        assert.equal(result.status, 503, await result.clone().text());
        assert.equal(result.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(await result.json(), { ok: false, message: GENERIC });
        assert.deepEqual(errors, [["[MIG-0654] owner transfer unavailable"]]);
      });
      assert.equal(inspections, previousInspections + 1);
      assert.equal(s.receipt.routeFaults, 1);
      assert.equal(s.receipt.readFaults, 0);
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
    // SEC-930: representative inherited names must fail before preparation for both methods/presets.
    ["POST", "/", { ...upsert, permission_keys: "constructor" }, "不正な権限キーです: constructor"],
    ["PUT", "/s-owner", { ...upsert, staff_id: "s-owner", permission_keys: "event.members, __proto__" }, "不正な権限キーです: __proto__"],
    ["POST", "/", { ...upsert, permission_preset: "custom", permission_keys: "__proto__" }, "不正な権限キーです: __proto__"],
    ["PUT", "/s-owner", { ...upsert, staff_id: "s-owner", permission_preset: "custom", permission_keys: "videos.title, toString" }, "不正な権限キーです: toString"],
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

test("SEC-800: CSV wire X-ID validation preserves CURRENT line-specific error", async () => {
  const s = setup({ fault: { match: staffRead, error: new Error(CANARY) } });
  try {
    const valid = csv().rows[0];
    const invalidIds = [undefined, null, 42, {}, "", "   ", CANARY.repeat(3)];
    const marker = s.sqlite.prepare("SELECT * FROM public_build_state WHERE id=1").get();
    await withThrowingDiagnostics(async ({ errors, warnings }) => {
      for (const x_user_id of invalidIds) {
        const body = { reason: "CSV validation", rows: [valid, { ...valid, lineNumber: 19, x_user_id }] };
        const result = await s.send("POST", "/csv", body);
        assert.equal(result.status, 400, await result.clone().text());
        assert.deepEqual(await result.json(), { ok: false, message: "19行目: X IDが不正です" });
        assert.equal(result.headers.get("cache-control"), "private, no-store");
      }
      // A different first schema issue retains its existing message. Do not
      // replace all validation failures just because an invalid X ID is present.
      const mixed = { reason: "CSV validation", rows: [{ ...valid, display_name: "", x_user_id: "" }] };
      const parsed = EventStaffCsvBodySchema.safeParse(mixed);
      assert.equal(parsed.success, false);
      assert.deepEqual(parsed.error.issues[0].path, ["rows", 0, "display_name"]);
      const result = await s.send("POST", "/csv", mixed);
      assert.equal(result.status, 400, await result.clone().text());
      assert.deepEqual(await result.json(), { ok: false, message: parsed.error.issues[0].message });
      assert.equal(result.headers.get("cache-control"), "private, no-store");
      // The pre-existing canonical parser path still provides the same message.
      const canonical = await s.send("POST", "/csv", {
        reason: "CSV validation", rows: [{ ...valid, lineNumber: 23, x_user_id: "@@" }],
      });
      assert.equal(canonical.status, 400, await canonical.clone().text());
      assert.deepEqual(await canonical.json(), { ok: false, message: "23行目: X IDが不正です" });
      assert.equal(canonical.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(errors, []);
      assert.equal(warnings(), 0);
    });
    assert.equal(s.receipt.readFaults, 0);
    assert.equal(s.stats.batches, 0);
    assert.deepEqual(s.before(), s.initial);
    assert.deepEqual(s.sqlite.prepare("SELECT * FROM public_build_state WHERE id=1").get(), marker);
  } finally {
    s.sqlite.close();
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

test("SEC-800: owner transfer rejects stale CAS and revoked eligibility without partial audit or projection", async () => {
  // Different-timestamp CAS and live eligibility are existing core guarantees.
  // Same-second snapshot conflicts (#933) are deliberately a separate core fix.
  const scenarios = [
    ["target version", "UPDATE event_staff SET display_name='Concurrent target', updated_at=2 WHERE id='s-target'"],
    ["source version", "UPDATE event_staff SET display_name='Concurrent source', updated_at=2 WHERE id='s-owner'"],
    ["target approval", "UPDATE x_users SET approval_status='pending' WHERE id='target_x'"],
    ["target owner link", "DELETE FROM x_user_account_links WHERE x_user_id='target_x' AND link_role='owner'"],
    ["target deleted", "DELETE FROM event_staff WHERE id='s-target'"],
  ];
  const snapshot = (sqlite) => [
    ...["event_staff", "x_users", "audit_logs", "static_rebuild_queue", "public_build_state"]
      .map((table) => sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY id').all()),
    sqlite.prepare("SELECT * FROM x_user_account_links ORDER BY auth_user_id, x_user_id, link_role").all(),
  ];
  for (const [label, competingSql] of scenarios) {
    let competingState;
    const s = setup({ beforeTransferBatch: (sqlite) => {
      sqlite.exec(competingSql);
      competingState = snapshot(sqlite);
    } });
    try {
      s.sqlite.exec(`
        INSERT INTO x_users (id, x_name, approval_status) VALUES ('target_x', 'Target', 'approved');
        INSERT INTO x_user_account_links (auth_user_id, x_user_id, link_role) VALUES ('admin-1', 'target_x', 'owner');
        INSERT INTO event_staff (id, event_id, x_user_id, display_name, permission_preset, is_public, created_at, updated_at)
          VALUES ('s-target', 'ev-1', 'target_x', 'Target', 'reviewer', 0, 1, 1);
      `);
      const beforeCompeting = snapshot(s.sqlite);
      await withThrowingDiagnostics(async ({ errors, warnings }) => {
        const result = await s.send("POST", "/owner-transfer", transfer);
        assert.equal(result.status, 503, label + ": " + await result.clone().text());
        assert.equal(result.headers.get("cache-control"), "private, no-store", label);
        assert.deepEqual(await result.json(), { ok: false, message: GENERIC }, label);
        assert.deepEqual(errors, [["[MIG-0654] owner transfer unavailable"]], label);
        assert.equal(warnings(), 0, label);
      });
      assert.equal(s.receipt.transferInterleavings, 1, label);
      assert.equal(s.receipt.readFaults, 0, label);
      assert.equal(s.stats.batches, 1, label + ": actual mutation batch attempted");
      assert.ok(competingState, label + ": competing write reached");
      assert.notDeepEqual(competingState, beforeCompeting, label + ": competing write changed state");
      assert.deepEqual(snapshot(s.sqlite), competingState, label + ": rollback preserves only competing write");
      assert.equal(s.count("audit_logs"), 0, label);
      assert.equal(s.count("static_rebuild_queue"), 0, label);
      assert.equal(s.sqlite.prepare("SELECT permission_preset FROM event_staff WHERE id='s-owner'").get().permission_preset, "owner", label);
    } finally {
      s.sqlite.close();
    }
  }
});

test("SEC-800: projection and diagnostic failure after strict audit preserves original success", async () => {
  const expectedRouteLog = [["[MIG-0654] post-commit staff projection enqueue failed"]];
  for (const mode of ["queue", "route"]) {
    const s = setup({ failQueue: mode === "queue", failRouteDb: mode === "route" });
    try {
      const markerBefore = s.sqlite.prepare("SELECT * FROM public_build_state WHERE id=1").get();
      assert.ok(markerBefore, "MIG-0516 marker fixture exists");
      await withThrowingDiagnostics(async ({ errors, warnings, warningArgs }) => {
        const result = await s.send("POST", "/", upsert);
        assert.equal(result.status, 200, await result.clone().text());
        assert.deepEqual(await result.json(), { ok: true, pendingPublicReflection: true });
        if (mode === "queue") {
          assert.equal(warnings(), 1);
          // After #436, a throwing shared warning sink is contained there:
          // one fixed warning, no private provider detail or duplicate route log.
          assert.deepEqual(warningArgs, [["[static-rebuild]", "bulk_enqueue_failed"]]);
          assert.deepEqual(errors, []);
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
      assert.deepEqual(s.sqlite.prepare("SELECT * FROM public_build_state WHERE id=1").get(), markerBefore,
        "failed post-commit projection does not advance the build marker");
      assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff WHERE x_user_id='added_user'").get().n, 1);
      assert.equal(s.sqlite.prepare("SELECT COUNT(*) AS n FROM x_users WHERE id='added_user'").get().n, 1);
    } finally {
      s.sqlite.close();
    }
  }
});

test("SEC-800: CSV assignment and X validation precedence matches CURRENT for mixed-invalid rows", async () => {
  const valid = csv().rows[0];
  const cases = [
    {
      name: "owner assignment before duplicate X",
      rows: [valid, { ...valid, lineNumber: 4, permission_preset: "owner" }],
      status: 409,
      message: "4行目: 代表者の追加・変更はCSVでは行えません。専用の代表者移譲操作を使用してください。",
    },
    {
      name: "admin-only assignment before duplicate X",
      rows: [valid, { ...valid, lineNumber: 4, permission_preset: "custom", permission_keys: ["xid.link_requests"] }],
      status: 400,
      message: "site admin 専用権限は付与できません。",
    },
    {
      name: "owner assignment before invalid X",
      rows: [valid, { ...valid, lineNumber: 4, permission_preset: "owner", x_user_id: "@@" }],
      status: 409,
      message: "4行目: 代表者の追加・変更はCSVでは行えません。専用の代表者移譲操作を使用してください。",
    },
    {
      name: "admin-only assignment before invalid X",
      rows: [valid, { ...valid, lineNumber: 4, permission_preset: "custom", permission_keys: ["xid.link_requests"], x_user_id: "@@" }],
      status: 400,
      message: "site admin 専用権限は付与できません。",
    },
    {
      name: "later invalid X before earlier duplicate detection",
      rows: [
        valid,
        { ...valid, lineNumber: 4 },
        { ...valid, lineNumber: 5, x_user_id: "@@" },
      ],
      status: 400,
      message: "5行目: X IDが不正です",
    },
  ];
  const s = setup({
    user: MEMBER,
    fault: { match: staffRead, error: new Error(CANARY) },
  });
  try {
    await withThrowingDiagnostics(async ({ errors, warnings }) => {
      for (const item of cases) {
        const result = await s.send("POST", "/csv", {
          reason: "CURRENT mixed-invalid precedence",
          rows: item.rows,
        });
        assert.equal(result.status, item.status, item.name + ": " + await result.clone().text());
        assert.deepEqual(await result.json(), { ok: false, message: item.message }, item.name);
        assert.equal(result.headers.get("cache-control"), "private, no-store", item.name);
      }
      assert.deepEqual(errors, []);
      assert.equal(warnings(), 0);
    });
    assert.equal(s.receipt.readFaults, 0, "all validation failures precede preparation reads");
    assert.equal(s.stats.batches, 0);
    assert.deepEqual(s.before(), s.initial);
  } finally {
    s.sqlite.close();
  }
});

test("SEC-800: CSV stored duplicate and atomic-budget denials preserve CURRENT messages", async () => {
  const storedDuplicate = "同じX IDを指す既存スタッフ行が複数あるため、先に整理してください。";
  const snapshot = (s) => ["event_staff", "x_users", "audit_logs", "static_rebuild_queue", "public_build_state"]
    .map((table) => s.sqlite.prepare('SELECT * FROM "' + table + '" ORDER BY id').all());
  const s = setup();
  try {
    s.sqlite.exec(`
      INSERT INTO event_staff (id, event_id, x_user_id, display_name, permission_preset, is_public, created_at, updated_at)
      VALUES ('s-csv-a', 'ev-1', 'csv_staff', 'A', 'public_staff', 0, 1, 1),
             ('s-csv-b', 'ev-1', '@CSV_STAFF', 'B', 'public_staff', 0, 1, 1);
    `);
    const before = snapshot(s);
    await withThrowingDiagnostics(async ({ errors, warnings }) => {
      const res = await s.send("POST", "/csv", { reason: "Stored duplicate", rows: csv().rows });
      assert.equal(res.status, 409, await res.clone().text());
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await res.json(), { ok: false, message: storedDuplicate });
      assert.deepEqual(errors, []);
      assert.equal(warnings(), 0);
    });
    assert.equal(s.stats.batches, 0);
    assert.deepEqual(snapshot(s), before);
  } finally {
    s.sqlite.close();
  }
  const csvDuplicate = setup();
  try {
    const before = snapshot(csvDuplicate);
    const rows = [csv().rows[0], { ...csv().rows[0], lineNumber: 9 }];
    await withThrowingDiagnostics(async ({ errors, warnings }) => {
      const res = await csvDuplicate.send("POST", "/csv", { reason: "CSV duplicate", rows });
      assert.equal(res.status, 409, await res.clone().text());
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await res.json(), {
        ok: false, message: "9行目: X IDは2行目と重複しています",
      });
      assert.deepEqual(errors, []);
      assert.equal(warnings(), 0);
    });
    assert.equal(csvDuplicate.stats.batches, 0);
    assert.deepEqual(snapshot(csvDuplicate), before);
  } finally {
    csvDuplicate.sqlite.close();
  }
  const fault = setup({ fault: { match: staffRead, error: new Error(storedDuplicate) } });
  try {
    const before = snapshot(fault);
    await withThrowingDiagnostics(async ({ errors, warnings }) => {
      const res = await fault.send("POST", "/csv", csv());
      assert.equal(res.status, 503, await res.clone().text());
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await res.json(), { ok: false, message: GENERIC });
      assert.deepEqual(errors, [["[MIG-0654] CSV staff mutation unavailable"]]);
      assert.equal(warnings(), 0);
    });
    assert.equal(fault.receipt.readFaults, 1);
    assert.equal(fault.stats.batches, 0);
    assert.deepEqual(snapshot(fault), before);
  } finally {
    fault.sqlite.close();
  }
  for (const [total, knownCount, expectedQueries] of [[13, 13, 54], [7, 0, 56], [12, 11, 54], [100, 100, 270]]) {
    const s = setup();
    try {
      const rows = Array.from({ length: total }, (_, i) => ({
        ...csv().rows[0], lineNumber: i + 2, x_user_id: "limit_" + i,
      }));
      const insert = s.sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, 'approved')");
      for (const row of rows.slice(0, knownCount)) insert.run(row.x_user_id, row.display_name);
      const before = snapshot(s);
      await withThrowingDiagnostics(async ({ errors, warnings }) => {
        const res = await s.send("POST", "/csv", { reason: "Budget denial", rows });
        assert.equal(res.status, 400, await res.clone().text());
        assert.equal(res.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(await res.json(), { ok: false,
          message: `このCSVは1回の原子更新上限を超えています（${expectedQueries}/50 query）。件数を分けて登録してください`,
        });
        assert.deepEqual(errors, []);
        assert.equal(warnings(), 0);
      });
      assert.equal(s.stats.batches, 0);
      assert.deepEqual(snapshot(s), before);
    } finally {
      s.sqlite.close();
    }
  }
});

test("SEC-800: SA-031 blank public role labels preserve CURRENT storage and audit snapshots", async () => {
  const cases = [
    [undefined, null],
    [null, null],
    ["", null],
    [" \t\r\n", null],
    ["\u3000\u00a0\ufeff", null],
    ["  Reviewer  ", "Reviewer"],
    [" 運営スタッフ ", "運営スタッフ"],
    ["\u200b", "\u200b"],
    ["x".repeat(40), "x".repeat(40)],
  ];
  for (const [input, expected] of cases) {
    for (const isPublic of [0, 1]) {
      const s = setup();
      try {
        s.sqlite.exec(`
          INSERT INTO x_users (id, x_name, approval_status) VALUES
            ('added_user', 'Added', 'approved'), ('update_user', 'Update', 'approved');
          INSERT INTO event_staff (id, event_id, x_user_id, display_name, permission_preset, is_public, public_role_label, created_at, updated_at)
          VALUES ('s-label', 'ev-1', 'update_user', 'Original', 'public_staff', 0, 'Before', 1, 1);
        `);
        const label = input === undefined ? {} : { public_role_label: input };
        const payload = { ...upsert, ...label, is_public: isPublic };
        const created = await s.send("POST", "/", payload);
        assert.equal(created.status, 200, await created.clone().text());
        assert.equal(created.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(await created.json(), { ok: true, pendingPublicReflection: true });
        const row = s.sqlite.prepare("SELECT * FROM event_staff WHERE x_user_id='added_user'").get();
        assert.equal(row.public_role_label, expected);
        assert.equal(row.is_public, isPublic);
        const createAudit = s.sqlite.prepare("SELECT * FROM audit_logs WHERE table_name='event_staff' AND target_id=? AND operation='CREATE'").get(row.id);
        assert.ok(createAudit, "strict create audit is present");
        assert.equal(createAudit.before_json, null);
        assert.equal(JSON.parse(createAudit.after_json).public_role_label, expected);
        assert.equal(JSON.parse(createAudit.after_json).is_public, isPublic);
        const updated = await s.send("PUT", "/s-label", { ...payload, staff_id: "s-label", x_user_id: "update_user" });
        assert.equal(updated.status, 200, await updated.clone().text());
        assert.equal(updated.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(await updated.json(), { ok: true, pendingPublicReflection: true });
        const after = s.sqlite.prepare("SELECT * FROM event_staff WHERE id='s-label'").get();
        assert.equal(after.public_role_label, expected);
        assert.equal(after.is_public, isPublic);
        const updateAudit = s.sqlite.prepare("SELECT * FROM audit_logs WHERE table_name='event_staff' AND target_id='s-label' AND operation='UPDATE'").get();
        assert.ok(updateAudit, "strict update audit is present");
        assert.equal(JSON.parse(updateAudit.before_json).public_role_label, "Before");
        assert.equal(JSON.parse(updateAudit.after_json).public_role_label, expected);
        assert.equal(JSON.parse(updateAudit.after_json).is_public, isPublic);
        assert.equal(s.count("audit_logs"), 2, "only the two staff writes are audited");
        assert.equal(s.count("x_users"), 3, "existing X identities are reused");
        assert.equal(s.sqlite.prepare("SELECT permission_preset FROM event_staff WHERE id='s-owner'").get().permission_preset, "owner");
      } finally {
        s.sqlite.close();
      }
    }
  }
  const s = setup({ fault: { match: staffRead, error: new Error(CANARY) } });
  try {
    for (const [method, path, body] of [
      ["POST", "/", upsert],
      ["PUT", "/s-owner", { ...upsert, staff_id: "s-owner" }],
    ]) {
      const res = await s.send(method, path, { ...body, public_role_label: "x".repeat(41) });
      assert.equal(res.status, 400, await res.clone().text());
      assert.equal(res.headers.get("cache-control"), "private, no-store");
    }
    assert.equal(s.receipt.readFaults, 0);
    assert.equal(s.stats.batches, 0);
    assert.deepEqual(s.before(), s.initial);
  } finally {
    s.sqlite.close();
  }
});

test("SEC-800: shared ownership-core provider reads cannot impersonate allowlisted domain conflicts", async () => {
  const eventStaffWhere = (statement) =>
    statement.match(/\bWHERE\b([\s\S]*?)(?:\bORDER\s+BY\b|\bLIMIT\b|$)/i)?.[1] ?? "";
  const ownerRowsRead = (statement) => {
    const where = eventStaffWhere(statement);
    return /"event_staff"\."event_id"\s*=\s*\?/i.test(where) &&
      /"event_staff"\."permission_preset"\s*=\s*\?/i.test(where) &&
      /\bEXISTS\s*\(/i.test(where) &&
      /\bx_users\b/i.test(where);
  };
  const uniquenessRead = (statement) => {
    const where = eventStaffWhere(statement).trim().replace(/^\(+|\)+$/g, "").trim();
    return /^"event_staff"\."event_id"\s*=\s*\?$/i.test(where);
  };
  const transferTargetRead = (statement) => {
    const where = eventStaffWhere(statement);
    return /"event_staff"\."event_id"\s*=\s*\?/i.test(where) &&
      /"event_staff"\."id"\s+IN\s*\(\s*\?\s*,\s*\?\s*\)/i.test(where);
  };
  const approvedLinkedXRead = (statement) =>
    /FROM\s+"x_user_account_links"\s+INNER JOIN\s+"x_users"/i.test(statement) &&
    /"x_user_account_links"\."auth_user_id"\s*=\s*\?/i.test(statement) &&
    /"x_users"\."approval_status"\s*=\s*\?/i.test(statement) &&
    !/"x_user_account_links"\."link_role"/i.test(statement);
  const operableOwnerLinkRead = (statement) =>
    /FROM\s+"x_user_account_links"/i.test(statement) &&
    /"x_user_account_links"\."link_role"\s*=\s*\?/i.test(statement) &&
    /"x_users"\."approval_status"\s*=\s*\?/i.test(statement);
  const cases = [
    {
      name: "non-admin owner eligibility read",
      user: MEMBER,
      method: "POST",
      path: "/",
      body: { ...upsert, permission_preset: "owner" },
      match: ownerRowsRead,
      error: new Error("代表権限を付与できるのはイベント代表者または管理者だけです。"),
      diagnostic: "[MIG-0654] staff upsert unavailable",
    },
    {
      name: "non-admin approved-X eligibility read",
      user: MEMBER,
      method: "POST",
      path: "/",
      body: { ...upsert, permission_preset: "owner" },
      match: approvedLinkedXRead,
      error: new Error("代表権限を付与できるのはイベント代表者または管理者だけです。"),
      diagnostic: "[MIG-0654] staff upsert unavailable",
    },
    {
      name: "create uniqueness read",
      user: ADMIN,
      method: "POST",
      path: "/",
      body: upsert,
      match: uniquenessRead,
      error: new Error(LAST_OWNER_ERROR),
      diagnostic: "[MIG-0654] staff upsert unavailable",
    },
    {
      name: "owner operability read",
      user: ADMIN,
      method: "POST",
      path: "/",
      body: { ...upsert, permission_preset: "owner" },
      match: operableOwnerLinkRead,
      error: new Error("イベント代表者には、承認済みX IDとowner roleのaccount linkが必要です。"),
      diagnostic: "[MIG-0654] staff upsert unavailable",
    },
    {
      name: "delete owner-retention read",
      user: ADMIN,
      method: "DELETE",
      path: "/s-owner",
      body: { reason: "remove" },
      match: ownerRowsRead,
      error: new Error(LAST_OWNER_ERROR),
      diagnostic: "[MIG-0654] staff delete unavailable",
    },
    {
      name: "CSV bulk existing-row read",
      user: ADMIN,
      method: "POST",
      path: "/csv",
      body: csv(),
      match: uniquenessRead,
      error: new Error(LAST_OWNER_ERROR),
      diagnostic: "[MIG-0654] CSV staff mutation unavailable",
    },
    {
      name: "owner transfer target read",
      user: ADMIN,
      method: "POST",
      path: "/owner-transfer",
      body: transfer,
      match: transferTargetRead,
      error: new Error(LAST_OWNER_ERROR),
      diagnostic: "[MIG-0654] owner transfer unavailable",
    },
  ];
  for (const item of cases) {
    const s = setup({ user: item.user, fault: { match: item.match, error: item.error } });
    try {
      await withThrowingDiagnostics(async ({ errors }) => {
        const result = await s.send(item.method, item.path, item.body);
        assert.equal(result.status, 503, item.name + ": " + await result.clone().text());
        assert.equal(result.headers.get("cache-control"), "private, no-store", item.name);
        assert.deepEqual(await result.json(), { ok: false, message: GENERIC }, item.name);
        assert.deepEqual(errors, [[item.diagnostic]], item.name);
      });
      assert.equal(s.receipt.readFaults, 1, item.name + " injects one shared-core read fault");
      assert.equal(s.stats.batches, 0, item.name + " fails before mutation/audit batch");
      assert.deepEqual(s.before(), s.initial, item.name + " leaves all rows and queues unchanged");
    } finally {
      s.sqlite.close();
    }
  }
});



function captureNextRedirectError() {
  try {
    redirect("/events/ev-1");
  } catch (error) {
    return error;
  }
  throw new Error("Next redirect did not interrupt control flow");
}

test("SEC-800: shared ownership read wrappers preserve pinned Next control-flow causes", async () => {
  const redirectError = captureNextRedirectError();
  const eventStaffWhere = (statement) =>
    statement.match(/\bWHERE\b([\s\S]*?)(?:\bORDER\s+BY\b|\bLIMIT\b|$)/i)?.[1] ?? "";
  const ownerRowsRead = (statement) => {
    const where = eventStaffWhere(statement);
    return /"event_staff"\."event_id"\s*=\s*\?/i.test(where) &&
      /"event_staff"\."permission_preset"\s*=\s*\?/i.test(where) &&
      /\bEXISTS\s*\(/i.test(where) && /\bx_users\b/i.test(where);
  };
  const approvedLinkedXRead = (statement) =>
    /FROM\s+"x_user_account_links"\s+INNER JOIN\s+"x_users"/i.test(statement) &&
    /"x_user_account_links"\."auth_user_id"\s*=\s*\?/i.test(statement) &&
    /"x_users"\."approval_status"\s*=\s*\?/i.test(statement) &&
    !/"x_user_account_links"\."link_role"\s*=\s*\?/i.test(statement);
  const transferTargetRead = (statement) => {
    const where = eventStaffWhere(statement);
    return /"event_staff"\."event_id"\s*=\s*\?/i.test(where) &&
      /"event_staff"\."id"\s+IN\s*\(\s*\?\s*,\s*\?\s*\)/i.test(where);
  };
  const cases = [
    ["owner eligibility read", ownerRowsRead, (db) => assertActorMayAssignOwner({
      db, eventId: "ev-1", actorUserId: "admin-1", isSiteAdmin: false,
    })],
    ["approved-X eligibility read", approvedLinkedXRead, (db) => assertActorMayAssignOwner({
      db, eventId: "ev-1", actorUserId: "admin-1", isSiteAdmin: false,
    })],
    ["ownership transfer target read", transferTargetRead, (db) => transferEventOwnership({
      db, eventId: "ev-1", fromStaffId: "s-owner", toStaffId: "s-target",
      actorUserId: "admin-1", reason: "handover", confirmText: "TRANSFER ev-1",
      selfConfirmText: "SELF CHANGE ev-1",
    })],
  ];
  for (const [label, match, invoke] of cases) {
    const s = setup({ user: MEMBER, fault: { match, error: redirectError } });
    try {
      let wrapped;
      try {
        await invoke(drizzle(s.db, { schema }));
      } catch (error) {
        wrapped = error;
      }
      assert.ok(wrapped instanceof Error, label + ": provider read was wrapped");
      assert.equal(wrapped.message, "event ownership preparation read failed", label);
      assert.throws(() => unstable_rethrow(wrapped), (error) => error === redirectError, label);
      assert.equal(s.receipt.readFaults, 1, label);
      assert.equal(s.stats.batches, 0, label);
      assert.deepEqual(s.before(), s.initial, label);
    } finally {
      s.sqlite.close();
    }
  }
});

test("SEC-800: genuine non-owner denial remains the fixed 409 after both reads succeed", async () => {
  const s = setup({ user: MEMBER });
  try {
    s.sqlite.exec(
      "INSERT INTO x_users (id, x_name, approval_status) VALUES ('other_owner_x', 'Other Owner', 'approved');\n" +
      "INSERT INTO x_user_account_links (auth_user_id, x_user_id, link_role) VALUES ('admin-2', 'other_owner_x', 'owner');\n" +
      "UPDATE event_staff SET x_user_id = 'other_owner_x' WHERE id = 's-owner';\n" +
      "INSERT INTO event_staff (id, event_id, x_user_id, display_name, permission_preset, custom_permission_keys_json, is_public, created_at, updated_at) " +
      "VALUES ('s-member', 'ev-1', 'owner_x', 'Member Manager', 'custom', json_array('event.members'), 0, 1, 1);"
    );
    const before = s.before();
    await withThrowingDiagnostics(async ({ errors, warnings }) => {
      const result = await s.send("POST", "/", { ...upsert, permission_preset: "owner" });
      assert.equal(result.status, 409, await result.clone().text());
      assert.equal(result.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await result.json(), {
        ok: false, message: "代表権限を付与できるのはイベント代表者または管理者だけです。",
      });
      assert.deepEqual(errors, []);
      assert.equal(warnings(), 0);
    });
    assert.equal(s.receipt.readFaults, 0);
    assert.equal(s.stats.batches, 0);
    assert.deepEqual(s.before(), before);
    assert.equal(
      s.sqlite.prepare("SELECT permission_preset FROM event_staff WHERE id='s-owner'").get().permission_preset,
      "owner",
    );
  } finally {
    s.sqlite.close();
  }
});
