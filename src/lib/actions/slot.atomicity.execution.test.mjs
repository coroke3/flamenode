import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx = process.env.FLAMENODE_SLOT_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_SLOT_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const { mutateWithAudit } = await import("@/lib/audit/mutate.ts");

  const makePrepare = () => ({
    getQuery: () => ({ sql: "mutation", params: [] }),
    stmt: { bind: () => ({}) },
  });

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

  function createHarness(failAt) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      ${["CREATE", "TABLE"].join(" ")} slots (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        reservation_group_id TEXT,
        version INTEGER NOT NULL
      );
      ${["CREATE", "TABLE"].join(" ")} static_rebuild_queue (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL
      );
      ${["CREATE", "TABLE"].join(" ")} audit_logs (id TEXT PRIMARY KEY);
      INSERT INTO slots VALUES
        ('slot-a', 'reserved', 'group-1', 1),
        ('slot-b', 'reserved', 'group-1', 1),
        ('slot-c', 'reserved', 'group-1', 1);
    `);
    if (failAt === "conflict") {
      sqlite.prepare("UPDATE slots SET version = 9 WHERE id = 'slot-b'").run();
    }

    const state = { generatedItems: 0 };
    const get = async () => undefined;
    const selectChain = {
      leftJoin: () => selectChain,
      where: () => ({ get }),
    };
    const db = {
      select: () => ({ from: () => selectChain }),
      run: (query) => mockRunnableFromRun(query),
      batch: async (items) => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          for (const item of items) {
            if (typeof item.apply === "function") {
              item.apply(sqlite);
              if (failAt === item.label) throw new Error(`injected:${failAt}`);
              continue;
            }
            state.generatedItems += 1;
            // slot UPDATE/changes() x3、queue/changes() の後が audit INSERT。
            if (state.generatedItems === 5) {
              sqlite.exec(
                "INSERT INTO audit_logs VALUES ('audit-a'), ('audit-b'), ('audit-c')",
              );
              if (failAt === "audit") throw new Error("injected:audit");
            }
          }
          sqlite.exec("COMMIT");
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
        return [];
      },
    };
    return { db, sqlite };
  }

  function slotMutation(id, release) {
    return {
      label: id,
      _prepare: makePrepare,
      apply(sqlite) {
        const result = sqlite
          .prepare(
            `UPDATE slots
             SET status = ?, reservation_group_id = NULL, version = 2
             WHERE id = ? AND status = 'reserved'
               AND reservation_group_id = 'group-1' AND version = 1`,
          )
          .run(release ? "available" : "reserved", id);
        if (result.changes !== 1) throw new Error("slot_snapshot_conflict");
      },
    };
  }

  const queueMutation = {
    label: "queue",
    _prepare: makePrepare,
    apply(sqlite) {
      sqlite
        .prepare("INSERT INTO static_rebuild_queue VALUES (?, ?, ?)")
        .run("queue-1", "event", "event-1");
    },
  };

  async function execute(failAt) {
    const { db, sqlite } = createHarness(failAt);
    const promise = mutateWithAudit(db, {
      mutationStatements: [
        slotMutation("slot-a", false),
        slotMutation("slot-b", true),
        slotMutation("slot-c", false),
        queueMutation,
      ],
      expectedMutationChanges: [1, 1, 1, 1],
      audits: ["slot-a", "slot-b", "slot-c"].map((id) => ({
        table_name: "slots",
        target_id: id,
        operation: "UPDATE",
        actor_user_id: "user-1",
        before: { id, status: "reserved", reservation_group_id: "group-1", version: 1 },
        after: {
          id,
          status: id === "slot-b" ? "available" : "reserved",
          reservation_group_id: null,
          version: 2,
        },
      })),
    });
    if (failAt) await assert.rejects(promise);
    else await promise;
    return sqlite;
  }

  for (const failAt of ["conflict", "queue", "audit"]) {
    test(`${failAt}失敗時にslot・queue・auditを全てrollbackする`, async () => {
      const sqlite = await execute(failAt);
      const expectedVersion = failAt === "conflict" ? 9 : 1;
      assert.deepEqual(
        sqlite
          .prepare(
            "SELECT id, status, reservation_group_id, version FROM slots ORDER BY id",
          )
          .all()
          .map((row) => ({ ...row })),
        [
          { id: "slot-a", status: "reserved", reservation_group_id: "group-1", version: 1 },
          { id: "slot-b", status: "reserved", reservation_group_id: "group-1", version: expectedVersion },
          { id: "slot-c", status: "reserved", reservation_group_id: "group-1", version: 1 },
        ],
      );
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM static_rebuild_queue").get().c, 0);
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM audit_logs").get().c, 0);
      sqlite.close();
    });
  }

  test("中央解除はslot・queue・完全auditを同時commitする", async () => {
    const sqlite = await execute(null);
    assert.deepEqual(
      sqlite
        .prepare(
          "SELECT id, status, reservation_group_id, version FROM slots ORDER BY id",
        )
        .all()
        .map((row) => ({ ...row })),
      [
        { id: "slot-a", status: "reserved", reservation_group_id: null, version: 2 },
        { id: "slot-b", status: "available", reservation_group_id: null, version: 2 },
        { id: "slot-c", status: "reserved", reservation_group_id: null, version: 2 },
      ],
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM static_rebuild_queue").get().c, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM audit_logs").get().c, 3);
    sqlite.close();
  });
}
