import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx = process.env.FLAMENODE_INTERACTION_VISIBILITY_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--test",
      fileURLToPath(import.meta.url),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_INTERACTION_VISIBILITY_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  let currentHarness;

  mock.module("next/cache", {
    namedExports: {
      revalidatePath() {
        currentHarness.revalidations += 1;
      },
    },
  });
  mock.module("@/lib/auth/writeGuard", {
    namedExports: {
      async writeGuard() {
        return {
          ok: true,
          user: { id: "user-1", role: "user" },
          activeXId: "x-user-1",
        };
      },
    },
  });
  mock.module("@/lib/cloudflare", {
    namedExports: {
      getDatabase() {
        return currentHarness.db;
      },
    },
  });
  mock.module("@/lib/audit/mutate", {
    namedExports: {
      async mutateWithAudit() {
        currentHarness.auditMutations += 1;
        throw new Error("非公開対象では mutateWithAudit を呼んではいけません");
      },
    },
  });
  mock.module("@/lib/staticRebuild/enqueue", {
    namedExports: {
      async buildStaticRebuildQueueBatch() {
        currentHarness.queueBuilds += 1;
        throw new Error("非公開対象では rebuild queue を構築してはいけません");
      },
    },
  });

  const { toggleVideoInteraction } = await import("./interaction.ts");

  function createHarness(visibility) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      ${["CREATE", "TABLE"].join(" ")} videos (
        id TEXT PRIMARY KEY,
        visibility_status TEXT NOT NULL,
        youtube_video_id TEXT,
        app_like_count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      ${["CREATE", "TABLE"].join(" ")} video_interactions (
        x_user_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        interaction_type TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      ${["CREATE", "TABLE"].join(" ")} static_rebuild_queue (id TEXT PRIMARY KEY);
      ${["CREATE", "TABLE"].join(" ")} audit_logs (id TEXT PRIMARY KEY);
    `);
    if (visibility !== null) {
      sqlite
        .prepare(
          "INSERT INTO videos (id, visibility_status, youtube_video_id, app_like_count, updated_at) VALUES (?, ?, ?, 0, 100)",
        )
        .run("video-1", visibility, "youtube-1");
    }

    const state = {
      sqlite,
      auditMutations: 0,
      queueBuilds: 0,
      mutationBuilders: 0,
      revalidations: 0,
      db: null,
    };
    state.db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  async limit() {
                    const row = sqlite
                      .prepare(
                        "SELECT id, visibility_status, youtube_video_id, app_like_count, updated_at FROM videos WHERE id = 'video-1'",
                      )
                      .get();
                    return row ? [{ ...row }] : [];
                  },
                };
              },
            };
          },
        };
      },
      insert() {
        state.mutationBuilders += 1;
        throw new Error("非公開対象では INSERT を構築してはいけません");
      },
      update() {
        state.mutationBuilders += 1;
        throw new Error("非公開対象では UPDATE を構築してはいけません");
      },
      delete() {
        state.mutationBuilders += 1;
        throw new Error("非公開対象では DELETE を構築してはいけません");
      },
      run() {
        state.mutationBuilders += 1;
        throw new Error("非公開対象では SQL mutation を構築してはいけません");
      },
    };
    return state;
  }

  function assertNoSideEffects(harness) {
    assert.equal(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM video_interactions").get().count,
      0,
    );
    assert.equal(
      harness.sqlite.prepare("SELECT COALESCE(SUM(app_like_count), 0) AS count FROM videos").get()
        .count,
      0,
    );
    assert.equal(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count,
      0,
    );
    assert.equal(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM static_rebuild_queue").get().count,
      0,
    );
    assert.equal(harness.auditMutations, 0);
    assert.equal(harness.queueBuilds, 0);
    assert.equal(harness.mutationBuilders, 0);
    assert.equal(harness.revalidations, 0);
  }

  for (const visibility of ["private", "voided", "unlisted", null]) {
    for (const kind of ["like", "bookmark"]) {
      const label = visibility ?? "不存在";
      test(`${label} 動画への ${kind} は全副作用を0件に保つ`, async () => {
        const harness = createHarness(visibility);
        currentHarness = harness;
        const formData = new FormData();
        formData.set("video_id", "video-1");
        formData.set("kind", kind);

        const result = await toggleVideoInteraction(formData);

        assert.equal(result.ok, false);
        assertNoSideEffects(harness);
        harness.sqlite.close();
      });
    }
  }
}
