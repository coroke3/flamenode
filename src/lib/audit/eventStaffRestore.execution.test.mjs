import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

if (process.env.FLAMENODE_EVENT_STAFF_RESTORE_EXECUTION !== "1") {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_EVENT_STAFF_RESTORE_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const { DatabaseSync } = await import("node:sqlite");
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { getAdapter } = await import("./adapters.ts");

  const adapter = getAdapter("event_staff");
  assert.ok(adapter);

  const baseRow = (id, userId, preset) => ({
    id,
    event_id: "event-1",
    x_user_id: null,
    user_id: userId,
    display_name: userId,
    role: preset === "owner" ? "representative" : "staff",
    permission_preset: preset,
    custom_permission_keys_json: null,
    is_public: 0,
    public_role_label: null,
    internal_note: null,
    approved_by_user_id: null,
    approved_at: null,
    created_at: 100,
    updated_at: 200,
  });

  function runRestore(currentRows, targetSnapshot) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      ${["CREATE", "TABLE"].join(" ")} event_staff (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        x_user_id TEXT,
        user_id TEXT,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        permission_preset TEXT NOT NULL,
        custom_permission_keys_json TEXT,
        is_public INTEGER NOT NULL,
        public_role_label TEXT,
        internal_note TEXT,
        approved_by_user_id TEXT,
        approved_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    const insert = sqlite.prepare(`
      INSERT INTO event_staff VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of currentRows) insert.run(...Object.values(row));

    const current = currentRows.find((row) => row.id === targetSnapshot.id);
    assert.ok(current);
    const drizzleDb = drizzle(async () => ({ rows: [] }));
    const mutation = adapter.buildRestoreMutation(
      drizzleDb,
      targetSnapshot,
      "update_before",
      { expectedCurrent: current },
    );
    const compiled = mutation.query.toSQL();
    const result = sqlite.prepare(compiled.sql).run(...compiled.params);
    const restored = sqlite
      .prepare("SELECT permission_preset FROM event_staff WHERE id = ?")
      .get(targetSnapshot.id);
    sqlite.close();
    return { changes: Number(result.changes), preset: restored.permission_preset };
  }

  test("event_staff restoreはsole ownerの非owner snapshot復元を拒否する", () => {
    const current = baseRow("staff-1", "user-1", "owner");
    const target = { ...current, role: "staff", permission_preset: "manager" };
    assert.deepEqual(runRestore([current], target), { changes: 0, preset: "owner" });
  });

  test("event_staff restoreはownerが複数なら非owner snapshot復元を許可する", () => {
    const current = baseRow("staff-1", "user-1", "owner");
    const secondOwner = baseRow("staff-2", "user-2", "owner");
    const target = { ...current, role: "staff", permission_preset: "manager" };
    assert.deepEqual(runRestore([current, secondOwner], target), {
      changes: 1,
      preset: "manager",
    });
  });

  test("event_staff restoreは非ownerからownerへの昇格を許可する", () => {
    const current = baseRow("staff-1", "user-1", "manager");
    const target = { ...current, role: "representative", permission_preset: "owner" };
    assert.deepEqual(runRestore([current], target), { changes: 1, preset: "owner" });
  });
}
