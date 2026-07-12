import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx = process.env.FLAMENODE_VIDEO_PLAN_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_VIDEO_PLAN_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const { executeVideoAtomicWritePlan } = await import("./atomicWritePlan.ts");

  function createHarness(failAt) {
    const sqlite = new DatabaseSync(":memory:");
    const ddl = ["CREATE", "TABLE"].join(" ");
    sqlite.exec(`
      ${ddl} videos (id TEXT PRIMARY KEY);
      ${ddl} video_events (video_id TEXT, event_id TEXT);
      ${ddl} slots (id TEXT PRIMARY KEY, status TEXT);
      ${ddl} notification_outbox (id TEXT PRIMARY KEY);
      ${ddl} static_rebuild_queue (id TEXT PRIMARY KEY);
      ${ddl} audit_logs (id TEXT PRIMARY KEY);
      INSERT INTO slots VALUES ('slot-1', 'reserved');
    `);
    let generated = 0;
    const db = {
      select: () => ({ from: () => ({ where: () => ({ get: async () => undefined }) }) }),
      run: (query) => ({ kind: "generated", query }),
      batch: async (items) => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          for (const item of items) {
            if (typeof item.apply === "function") {
              item.apply(sqlite);
              if (item.label === failAt) throw new Error(`injected:${failAt}`);
              continue;
            }
            generated += 1;
            // Five changes assertions are followed by the audit INSERT/assertion pair.
            if (generated === 6) {
              sqlite.prepare("INSERT INTO audit_logs VALUES ('audit-1')").run();
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

  const mutation = (label, sqlText) => ({
    label,
    apply(sqlite) {
      sqlite.exec(sqlText);
    },
  });
  const statements = [
    mutation("video", "INSERT INTO videos VALUES ('video-1')"),
    mutation("relation", "INSERT INTO video_events VALUES ('video-1', 'event-1')"),
    mutation("slot", "UPDATE slots SET status = 'submitted' WHERE id = 'slot-1'"),
    mutation("notification", "INSERT INTO notification_outbox VALUES ('notice-1')"),
    mutation("queue", "INSERT INTO static_rebuild_queue VALUES ('queue-1')"),
  ];

  async function execute(failAt) {
    const { db, sqlite } = createHarness(failAt);
    const promise = executeVideoAtomicWritePlan(db, {
      statements,
      expectedChanges: [1, 1, 1, 1, 1],
      audits: [{
        table_name: "videos",
        target_id: "video-1",
        operation: "CREATE",
        before: null,
        after: { id: "video-1" },
        actor_user_id: "actor-1",
      }],
    });
    if (failAt) await assert.rejects(promise, new RegExp(`injected:${failAt}`));
    else await promise;
    return sqlite;
  }

  for (const failAt of ["video", "relation", "slot", "notification", "queue", "audit"]) {
    test(`${failAt}失敗時に作品保存全体をrollbackする`, async () => {
      const sqlite = await execute(failAt);
      assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM videos").get().count, 0);
      assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM video_events").get().count, 0);
      assert.equal(sqlite.prepare("SELECT status FROM slots").get().status, "reserved");
      assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM notification_outbox").get().count, 0);
      assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM static_rebuild_queue").get().count, 0);
      assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM audit_logs").get().count, 0);
      sqlite.close();
    });
  }

  test("成功時に作品・関連行・枠・通知・queue・auditを同時commitする", async () => {
    const sqlite = await execute(null);
    assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM videos").get().count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM video_events").get().count, 1);
    assert.equal(sqlite.prepare("SELECT status FROM slots").get().status, "submitted");
    assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM notification_outbox").get().count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM static_rebuild_queue").get().count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM audit_logs").get().count, 1);
    sqlite.close();
  });
}
