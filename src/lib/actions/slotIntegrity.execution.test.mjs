import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx = process.env.FLAMENODE_SLOT_INTEGRITY_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_SLOT_INTEGRITY_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const { mutateWithAudit } = await import("@/lib/audit/mutate.ts");

  const mockRunnableFromRun = (query) => {
    const sequel = { sql: String(query), params: [] };
    return {
      kind: "generated",
      query,
      getQuery: () => sequel,
      _prepare: () => ({
        getQuery: () => sequel,
        stmt: { bind: () => ({}) },
      }),
    };
  };

  test("mutateWithAudit failure returns through caller catch boundary", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE slots (id TEXT PRIMARY KEY, status TEXT NOT NULL, version INTEGER NOT NULL);
      CREATE TABLE audit_logs (id TEXT PRIMARY KEY);
      INSERT INTO slots VALUES ('slot-a', 'available', 1);
    `);
    const db = {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: () => ({ get: async () => undefined }),
          }),
        }),
      }),
      run: (query) => mockRunnableFromRun(query),
      batch: async () => {
        sqlite.exec("BEGIN IMMEDIATE");
        sqlite.exec("ROLLBACK");
        throw new Error("D1Conflict");
      },
    };

    let caught = false;
    try {
      await mutateWithAudit(db, {
        mutationStatements: [db.run("UPDATE slots SET status = 'reserved' WHERE id = 'slot-a'")],
        expectedMutationChanges: [1],
        audits: [{
          table_name: "slots",
          target_id: "slot-a",
          operation: "UPDATE",
          before: { id: "slot-a" },
          after: { id: "slot-a", status: "reserved" },
          actor_user_id: "user-1",
          retention_class: "normal",
          strict: true,
        }],
      });
    } catch {
      caught = true;
    }
    assert.equal(caught, true);
  });
}
