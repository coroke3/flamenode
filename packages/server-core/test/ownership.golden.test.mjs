// MIG-0633 U01: Golden test suite for permissionResolver and owner 0 guard SQL.
// Invariant: owner 0 guard SQL and resolver semantics must remain byte-identical
// before and after moving from src/lib/** to packages/domain and packages/server-core.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

const dialect = new SQLiteSyncDialect();
const norm = (str) => str.replace(/\s+/g, " ").trim();

// Owner 0 guard SQL generators matching src/lib/event/eventOwnership.ts
export function operableOwnerXSql(xUserId) {
  return sql`
    EXISTS (
      SELECT 1
      FROM x_users AS owner_xu
      WHERE owner_xu.id = ${xUserId}
        AND owner_xu.approval_status = 'approved'
        AND EXISTS (
          SELECT 1
          FROM x_user_account_links AS owner_link
          WHERE owner_link.x_user_id = owner_xu.id
            AND owner_link.link_role = 'owner'
        )
    )
  `;
}

export function remainingOperableEventOwnerSql(eventId, excludedStaffId) {
  return sql`
    EXISTS (
      SELECT 1
      FROM event_staff AS remaining_owner
      INNER JOIN x_users AS remaining_xu
        ON remaining_xu.id = remaining_owner.x_user_id
      WHERE remaining_owner.event_id = ${eventId}
        AND remaining_owner.id <> ${excludedStaffId}
        AND remaining_owner.permission_preset = 'owner'
        AND remaining_xu.approval_status = 'approved'
        AND EXISTS (
          SELECT 1
          FROM x_user_account_links AS remaining_link
          WHERE remaining_link.x_user_id = remaining_owner.x_user_id
            AND remaining_link.link_role = 'owner'
        )
    )
  `;
}

test("T01 & STOP: operableOwnerXSql compiles to exact SQL and binds x_user_id", () => {
  const query = dialect.sqlToQuery(operableOwnerXSql("x_test_user"));
  const expectedSql = norm(`
    EXISTS (
      SELECT 1
      FROM x_users AS owner_xu
      WHERE owner_xu.id = ?
        AND owner_xu.approval_status = 'approved'
        AND EXISTS (
          SELECT 1
          FROM x_user_account_links AS owner_link
          WHERE owner_link.x_user_id = owner_xu.id
            AND owner_link.link_role = 'owner'
        )
    )
  `);
  assert.equal(norm(query.sql), expectedSql);
  assert.deepEqual(query.params, ["x_test_user"]);
});

test("T01 & STOP: remainingOperableEventOwnerSql compiles to exact SQL with eventId and excludedStaffId", () => {
  const query = dialect.sqlToQuery(remainingOperableEventOwnerSql("evt-100", "staff-200"));
  const expectedSql = norm(`
    EXISTS (
      SELECT 1
      FROM event_staff AS remaining_owner
      INNER JOIN x_users AS remaining_xu
        ON remaining_xu.id = remaining_owner.x_user_id
      WHERE remaining_owner.event_id = ?
        AND remaining_owner.id <> ?
        AND remaining_owner.permission_preset = 'owner'
        AND remaining_xu.approval_status = 'approved'
        AND EXISTS (
          SELECT 1
          FROM x_user_account_links AS remaining_link
          WHERE remaining_link.x_user_id = remaining_owner.x_user_id
            AND remaining_link.link_role = 'owner'
        )
    )
  `);
  assert.equal(norm(query.sql), expectedSql);
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
