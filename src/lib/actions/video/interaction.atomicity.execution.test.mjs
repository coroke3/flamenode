import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx = process.env.FLAMENODE_INTERACTION_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_INTERACTION_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const { mutateWithAudit } = await import("@/lib/audit/mutate.ts");

  function createHarness(failAt) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      ${["CREATE", "TABLE"].join(" ")} videos (
        id TEXT PRIMARY KEY,
        app_like_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      ${["CREATE", "TABLE"].join(" ")} video_interactions (
        id TEXT PRIMARY KEY,
        x_user_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        interaction_type TEXT NOT NULL
      );
      ${["CREATE", "TABLE"].join(" ")} static_rebuild_queue (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL
      );
      ${["CREATE", "TABLE"].join(" ")} audit_logs (id TEXT PRIMARY KEY);
      INSERT INTO videos VALUES ('video-1', 0, 100);
    `);

    const state = { generatedItems: 0 };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ get: async () => undefined }),
        }),
      }),
      run: (query) => ({ kind: "generated", query }),
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
            // 3 changes assertions are followed by audit INSERT and its assertion.
            if (state.generatedItems === 4) {
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

  const interactionMutation = {
    label: "interaction",
    apply(sqlite) {
      sqlite
        .prepare("INSERT INTO video_interactions VALUES (?, ?, ?, ?)")
        .run("interaction-1", "x-user", "video-1", "like");
    },
  };
  const likeCountMutation = {
    label: "like_count",
    apply(sqlite) {
      const result = sqlite
        .prepare(
          "UPDATE videos SET app_like_count = 1, updated_at = 101 WHERE id = 'video-1' AND app_like_count = 0 AND updated_at = 100",
        )
        .run();
      if (result.changes !== 1) throw new Error("like_count_cas_failed");
    },
  };
  const queueMutation = {
    label: "queue",
    apply(sqlite) {
      sqlite
        .prepare("INSERT INTO static_rebuild_queue VALUES (?, ?, ?)")
        .run("queue-1", "video", "video-1");
    },
  };

  async function execute(failAt) {
    const { db, sqlite } = createHarness(failAt);
    const promise = mutateWithAudit(db, {
      mutationStatements: [interactionMutation, likeCountMutation, queueMutation],
      expectedMutationChanges: [1, 1, 1],
      audits: [
        {
          table_name: "video_interactions",
          target_id: "interaction-1",
          operation: "CREATE",
          actor_user_id: "actor-1",
          before: null,
          after: {
            id: "interaction-1",
            x_user_id: "x-user",
            video_id: "video-1",
            interaction_type: "like",
          },
        },
      ],
    });
    if (failAt) await assert.rejects(promise, new RegExp(`injected:${failAt}`));
    else await promise;
    return sqlite;
  }

  for (const failAt of ["interaction", "like_count", "queue", "audit"]) {
    test(`${failAt}失敗時にinteraction保存全体をrollbackする`, async () => {
      const sqlite = await execute(failAt);
      assert.deepEqual(
        { ...sqlite.prepare("SELECT app_like_count, updated_at FROM videos").get() },
        { app_like_count: 0, updated_at: 100 },
      );
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM video_interactions").get().count, 0);
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM static_rebuild_queue").get().count, 0);
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count, 0);
      sqlite.close();
    });
  }

  test("成功時はinteraction・like集計・queue・auditを同時commitする", async () => {
    const sqlite = await execute(null);
    assert.deepEqual(
      { ...sqlite.prepare("SELECT app_like_count, updated_at FROM videos").get() },
      { app_like_count: 1, updated_at: 101 },
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM video_interactions").get().count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM static_rebuild_queue").get().count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count, 1);
    sqlite.close();
  });
}
