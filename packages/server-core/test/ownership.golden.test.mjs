// MIG-0633 U01: Golden test suite for permissionResolver and owner 0 guard SQL.
// Invariant: owner 0 guard SQL and resolver semantics must remain byte-identical
// before and after moving from src/lib/** to packages/domain and packages/server-core.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import * as schema from "@flamenode/db/schema";
import {
  deleteEventStaffWithProtection,
  LAST_OWNER_ERROR,
  operableOwnerXSql,
  remainingOperableEventOwnerSql,
} from "../src/event/eventOwnership.ts";

const dialect = new SQLiteSyncDialect();

test("T01 & STOP: operableOwnerXSql compiles to exact SQL and binds x_user_id", () => {
  const query = dialect.sqlToQuery(operableOwnerXSql("x_test_user"));
  const expectedSql = "\n    EXISTS (\n      SELECT 1\n      FROM x_users AS owner_xu\n      WHERE owner_xu.id = ?\n        AND owner_xu.approval_status = 'approved'\n        AND EXISTS (\n          SELECT 1\n          FROM x_user_account_links AS owner_link\n          WHERE owner_link.x_user_id = owner_xu.id\n            AND owner_link.link_role = 'owner'\n        )\n    )\n  ";
  // Literal compare, whitespace included (Work Order STOP: 1 character changed).
  assert.equal(query.sql, expectedSql);
  assert.deepEqual(query.params, ["x_test_user"]);
});

test("T01 & STOP: remainingOperableEventOwnerSql compiles to exact SQL with eventId and excludedStaffId", () => {
  const query = dialect.sqlToQuery(remainingOperableEventOwnerSql("evt-100", "staff-200"));
  const expectedSql = "\n    EXISTS (\n      SELECT 1\n      FROM event_staff AS remaining_owner\n      INNER JOIN x_users AS remaining_xu\n        ON remaining_xu.id = remaining_owner.x_user_id\n      WHERE remaining_owner.event_id = ?\n        AND remaining_owner.id <> ?\n        AND remaining_owner.permission_preset = 'owner'\n        AND remaining_xu.approval_status = 'approved'\n        AND EXISTS (\n          SELECT 1\n          FROM x_user_account_links AS remaining_link\n          WHERE remaining_link.x_user_id = remaining_owner.x_user_id\n            AND remaining_link.link_role = 'owner'\n        )\n    )\n  ";
  // Literal compare, whitespace included (Work Order STOP: 1 character changed).
  assert.equal(query.sql, expectedSql);
  assert.deepEqual(query.params, ["evt-100", "staff-200"]);
});

test("T01: SQLite execution of remainingOperableEventOwnerSql matches owner presence", () => {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter((entry) => entry.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  sqlite.exec("PRAGMA foreign_keys = OFF");

  const NOW = 1_700_000_000;
  // Insert approved X user with owner link
  sqlite.prepare(
    "INSERT INTO x_users (id, x_name, approval_status) VALUES ('x_alice', 'Alice', 'approved')",
  ).run();
  sqlite.prepare(
    "INSERT INTO x_user_account_links (x_user_id, auth_user_id, link_role, created_at, updated_at) VALUES ('x_alice', 'u_alice', 'owner', ?, ?)",
  ).run(NOW, NOW);

  // Insert event staff
  sqlite.prepare(`
    INSERT INTO event_staff (
      id, event_id, x_user_id, display_name, permission_preset,
      custom_permission_keys_json, is_public, public_role_label,
      approved_by_auth_user_id, approved_at, created_at, updated_at
    ) VALUES ('staff-1', 'evt-1', 'x_alice', 'Alice', 'owner', NULL, 0, NULL, NULL, NULL, ?, ?)
  `).run(NOW, NOW);

  const query = dialect.sqlToQuery(remainingOperableEventOwnerSql("evt-1", "staff-1"));
  const rowExcluded = sqlite.prepare(`SELECT ${query.sql} AS has_remaining`).get(...query.params);
  assert.equal(rowExcluded.has_remaining, 0, "No remaining owner when staff-1 is excluded");

  const queryOther = dialect.sqlToQuery(remainingOperableEventOwnerSql("evt-1", "staff-999"));
  const rowOther = sqlite.prepare(`SELECT ${queryOther.sql} AS has_remaining`).get(...queryOther.params);
  assert.equal(rowOther.has_remaining, 1, "Owner staff-1 remains when staff-999 is excluded");

  sqlite.close();
});

test("T02: permissionResolver golden matrix matches preset permissions", async () => {
  // Can import from domain presets
  const { PRESET_DEFINITIONS, EVENT_STAFF_PRESETS } = await import("@flamenode/domain/auth/permissions/presets");

  // Verified snapshot of preset permission counts
  const expectedCounts = {
    owner: 14,
    manager: 13,
    reviewer: 2,
    slot_manager: 1,
    content_editor: 5,
    xid_reviewer: 1,
    public_staff: 0,
    custom: 0,
  };

  for (const preset of EVENT_STAFF_PRESETS) {
    const def = PRESET_DEFINITIONS[preset];
    assert.ok(def, `Preset ${preset} must have definition`);
    assert.equal(def.permissions.length, expectedCounts[preset], `Preset ${preset} count mismatch`);
  }
});

test("T02: resolveStaffPermissionKeys and getManageStaffRole golden matrix", async () => {
  const {
    resolveStaffPermissionKeys,
    getManageStaffRole,
    staffRowHasPermissionKey,
    normalizePermissionKeys,
    safeParseCustomPermissionKeys,
  } = await import("../../../src/lib/auth/permissions/permissionResolver.ts");

  // Owner preset
  const ownerKeys = resolveStaffPermissionKeys({ permission_preset: "owner" });
  assert.equal(ownerKeys.size, 14);
  assert.equal(getManageStaffRole({ permission_preset: "owner" }), "representative");
  assert.equal(staffRowHasPermissionKey({ permission_preset: "owner" }, "event.basic"), true);

  // Manager preset
  const managerKeys = resolveStaffPermissionKeys({ permission_preset: "manager" });
  assert.equal(managerKeys.size, 13);
  assert.equal(getManageStaffRole({ permission_preset: "manager" }), "editor");
  assert.equal(staffRowHasPermissionKey({ permission_preset: "manager" }, "event.basic"), true);

  // Custom preset with valid, alias, and unknown keys
  const customJson = JSON.stringify(["videos.title", "event.basic", "unknown.invalid.key", 123]);
  const customKeys = resolveStaffPermissionKeys({
    permission_preset: "custom",
    custom_permission_keys_json: customJson,
  });
  // 'videos.title' aliases to 'video.basics'
  assert.equal(customKeys.has("video.basics"), true);
  assert.equal(customKeys.has("event.basic"), true);
  assert.equal(customKeys.has("unknown.invalid.key"), false);
  assert.equal(getManageStaffRole({ permission_preset: "custom", custom_permission_keys_json: customJson }), "editor");

  // Empty staff row
  assert.equal(getManageStaffRole({ permission_preset: null }), null);
  assert.equal(getManageStaffRole({ permission_preset: "public_staff" }), null);

  // Safe parse
  assert.deepEqual(safeParseCustomPermissionKeys(null), []);
  assert.deepEqual(safeParseCustomPermissionKeys("not json"), []);
  assert.deepEqual(normalizePermissionKeys(["invalid", "video.basics"]), ["video.basics"]);
});

test("T02: every staff preset resolves to the golden key set and manage role", async () => {
  const { EVENT_STAFF_PRESETS } = await import("@flamenode/domain/auth/permissions/presets");
  const { resolveStaffPermissionKeys, getManageStaffRole } = await import("@flamenode/domain/auth/permissions/resolver");
  // Captured from src/lib/auth/permissions/permissionResolver.ts at main 16ba53a (before the move).
  const golden = {
    owner: ["representative", ["event.basic", "event.members", "event.notifications", "event.publish", "event.questions", "event.review", "event.slots", "video.basics", "video.credits", "video.descriptions", "video.member_chapters", "video.members", "video.permissions", "video.status"]],
    manager: ["editor", ["event.basic", "event.notifications", "event.publish", "event.questions", "event.review", "event.slots", "video.basics", "video.credits", "video.descriptions", "video.member_chapters", "video.members", "video.permissions", "video.status"]],
    slot_manager: ["editor", ["event.slots"]],
    content_editor: ["editor", ["video.basics", "video.credits", "video.descriptions", "video.member_chapters", "video.members"]],
    reviewer: ["editor", ["event.review", "video.status"]],
    xid_reviewer: ["editor", ["xid.link_requests"]],
    public_staff: [null, []],
    custom: [null, []],
  };
  assert.deepEqual([...EVENT_STAFF_PRESETS].sort(), Object.keys(golden).sort());
  for (const preset of EVENT_STAFF_PRESETS) {
    const [role, keys] = golden[preset];
    assert.deepEqual([...resolveStaffPermissionKeys({ permission_preset: preset })].sort(), keys, preset);
    assert.equal(getManageStaffRole({ permission_preset: preset }), role, preset);
  }
});

const NOW = 1_700_000_000;

function staffWorld({ owners, beforeBatch }) {
  const sqlite = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  const migrations = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter((entry) => entry.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec(`INSERT INTO "user" (id, name, discord_id, role, is_banned, is_tos_accepted) VALUES ('admin-1', 'Admin', 'd-1', 'admin', 0, 1)`);
  for (const [index, xUserId] of owners.entries()) {
    sqlite.prepare("INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, 'approved')").run(xUserId, xUserId);
    sqlite.prepare(
      "INSERT INTO x_user_account_links (x_user_id, auth_user_id, link_role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)",
    ).run(xUserId, `u_${xUserId}`, NOW, NOW);
    sqlite.prepare(`
      INSERT INTO event_staff (id, event_id, x_user_id, display_name, permission_preset, is_public, created_at, updated_at)
      VALUES (?, 'evt-1', ?, ?, 'owner', 0, ?, ?)
    `).run(`staff-${index + 1}`, xUserId, xUserId, NOW, NOW);
  }
  const stats = { batches: 0 };
  const run = (text, params) => sqlite.prepare(text).all(...params).map((row) => ({ ...row }));
  const statement = (text, params) => ({
    __sql: text,
    __params: params,
    bind: (...values) => statement(text, values),
    async all() {
      return { results: run(text, params) };
    },
    async run() {
      return { results: run(text, params), success: true, meta: { changes: 0 } };
    },
    async raw() {
      const prepared = sqlite.prepare(text);
      prepared.setReturnArrays(true);
      try {
        return prepared.all(...params).map((row) => [...row]);
      } finally {
        prepared.setReturnArrays(false);
      }
    },
  });
  const d1 = {
    prepare: (text) => statement(text, []),
    async batch(statements) {
      stats.batches += 1;
      beforeBatch?.(sqlite);
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => ({ results: run(s.__sql, s.__params) }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, stats, db: drizzle(d1, { schema }) };
}

const staffRow = (sqlite, id) => sqlite.prepare("SELECT * FROM event_staff WHERE id = ?").get(id);
const auditCount = (sqlite) => sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n;

test("T01: removing an owner while another operable owner remains succeeds (harness control)", async () => {
  const { sqlite, db } = staffWorld({ owners: ["x_alice", "x_bob"] });
  await deleteEventStaffWithProtection({
    db, existing: { ...staffRow(sqlite, "staff-1") }, actorUserId: "admin-1", reason: "test", confirmText: null,
  });
  assert.equal(staffRow(sqlite, "staff-1"), undefined);
  assert.equal(auditCount(sqlite), 1);
});

test("T01: removing the sole owner is rejected before any write", async () => {
  const { sqlite, stats, db } = staffWorld({ owners: ["x_alice"] });
  await assert.rejects(
    deleteEventStaffWithProtection({
      db, existing: { ...staffRow(sqlite, "staff-1") }, actorUserId: "admin-1", reason: "test", confirmText: null,
    }),
    (error) => error.message === LAST_OWNER_ERROR,
  );
  assert.equal(stats.batches, 0);
  assert.ok(staffRow(sqlite, "staff-1"));
});

test("T01: SQL guard rejects removing the last owner when the other owner vanished after the pre-check", async () => {
  // The pre-check sees staff-2 as the remaining owner; staff-2 is deleted right before the batch,
  // so only remainingOperableEventOwnerSql inside the DELETE can keep the event from losing its owner.
  const { sqlite, stats, db } = staffWorld({
    owners: ["x_alice", "x_bob"],
    beforeBatch: (s) => s.exec("DELETE FROM event_staff WHERE id = 'staff-2'"),
  });
  await assert.rejects(deleteEventStaffWithProtection({
    db, existing: { ...staffRow(sqlite, "staff-1") }, actorUserId: "admin-1", reason: "test", confirmText: null,
  }));
  assert.equal(stats.batches, 1);
  assert.ok(staffRow(sqlite, "staff-1"), "last owner row must survive");
  assert.equal(auditCount(sqlite), 0);
});
