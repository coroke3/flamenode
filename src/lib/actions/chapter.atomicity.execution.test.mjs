import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx = process.env.FLAMENODE_CHAPTER_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_CHAPTER_EXECUTION: "1",
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

  const mutation = (label, apply) => ({
    label,
    apply,
    _prepare: makePrepare,
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

  const scenarios = {
    create: {
      initial: "",
      statements: [
        mutation("chapter", (db) => db.prepare("INSERT INTO video_chapters VALUES ('ch-1', '新規', 100)").run()),
        mutation("notification", (db) => db.prepare("INSERT INTO notification_outbox VALUES ('notice-1')").run()),
        mutation("queue", (db) => db.prepare("INSERT INTO static_rebuild_queue VALUES ('queue-1')").run()),
      ],
      auditCount: 1,
    },
    update: {
      initial: "INSERT INTO video_chapters VALUES ('ch-1', '変更前', 100);",
      statements: [
        mutation("chapter", (db) => {
          const result = db.prepare("UPDATE video_chapters SET label='変更後', updated_at=101 WHERE id='ch-1' AND label='変更前' AND updated_at=100").run();
          if (result.changes !== 1) throw new Error("chapter_cas_failed");
        }),
        mutation("queue", (db) => db.prepare("INSERT INTO static_rebuild_queue VALUES ('queue-1')").run()),
      ],
      auditCount: 1,
    },
    delete: {
      initial: "INSERT INTO video_chapters VALUES ('ch-1', '削除前', 100);",
      statements: [
        mutation("chapter", (db) => {
          const result = db.prepare("DELETE FROM video_chapters WHERE id='ch-1' AND label='削除前' AND updated_at=100").run();
          if (result.changes !== 1) throw new Error("chapter_cas_failed");
        }),
        mutation("queue", (db) => db.prepare("INSERT INTO static_rebuild_queue VALUES ('queue-1')").run()),
      ],
      auditCount: 1,
    },
    bulk: {
      initial: "",
      statements: [
        mutation("chapter", (db) => db.exec("INSERT INTO video_chapters VALUES ('ch-1', '一括1', 100), ('ch-2', '一括2', 100)")),
        mutation("queue", (db) => db.prepare("INSERT INTO static_rebuild_queue VALUES ('queue-1')").run()),
      ],
      auditCount: 2,
    },
  };

  function createHarness(scenario, failAt) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      ${["CREATE", "TABLE"].join(" ")} video_chapters (id TEXT PRIMARY KEY, label TEXT NOT NULL, updated_at INTEGER NOT NULL);
      ${["CREATE", "TABLE"].join(" ")} notification_outbox (id TEXT PRIMARY KEY);
      ${["CREATE", "TABLE"].join(" ")} static_rebuild_queue (id TEXT PRIMARY KEY);
      ${["CREATE", "TABLE"].join(" ")} audit_logs (id TEXT PRIMARY KEY);
      ${scenario.initial}
    `);
    let generatedItems = 0;
    const preparationQueries = {
      settings: 0,
      actor: 0,
      actorLeftJoins: 0,
    };
    const db = {
      select: (projection) => ({
        from: () => {
          let joinedActorXUser = false;
          const query = {
            leftJoin: () => {
              if (projection === undefined) {
                throw new Error("settings query must not join actor X user");
              }
              joinedActorXUser = true;
              preparationQueries.actorLeftJoins += 1;
              return query;
            },
            where: () => ({
              get: async () => {
                if (projection === undefined) {
                  preparationQueries.settings += 1;
                } else {
                  if (!joinedActorXUser) {
                    throw new Error("actor snapshot query must join active X user");
                  }
                  preparationQueries.actor += 1;
                }
                return undefined;
              },
            }),
          };
          return query;
        },
      }),
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
            generatedItems += 1;
            // mutationごとのchanges assertion後に、監査INSERTと監査assertionが続く。
            if (generatedItems === scenario.statements.length + 1) {
              for (let index = 0; index < scenario.auditCount; index += 1) {
                sqlite.prepare("INSERT INTO audit_logs VALUES (?)").run(`audit-${index}`);
              }
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
    return { db, sqlite, preparationQueries };
  }

  async function execute(scenario, failAt) {
    const { db, sqlite, preparationQueries } = createHarness(scenario, failAt);
    const promise = mutateWithAudit(db, {
      mutationStatements: scenario.statements,
      expectedMutationChanges: scenario.statements.map(() => 1),
      audits: Array.from({ length: scenario.auditCount }, (_, index) => ({
        table_name: "video_chapters",
        target_id: `ch-${index + 1}`,
        operation: "CREATE",
        before: null,
        after: { id: `ch-${index + 1}` },
        actor_user_id: "actor-1",
      })),
    });
    await assert.rejects(promise, new RegExp(`injected:${failAt}`));
    assert.deepEqual(preparationQueries, {
      settings: 1,
      actor: 1,
      actorLeftJoins: 1,
    });
    return sqlite;
  }

  for (const [name, scenario] of Object.entries(scenarios)) {
    for (const failAt of [...scenario.statements.map((item) => item.label), "audit"]) {
      test(`${name}の${failAt}失敗時は本体・通知・queue・監査をrollbackする`, async () => {
        const sqlite = await execute(scenario, failAt);
        const chapterRows = sqlite.prepare("SELECT id, label, updated_at FROM video_chapters ORDER BY id").all();
        if (name === "update") {
          assert.deepEqual(chapterRows.map((row) => ({ ...row })), [{ id: "ch-1", label: "変更前", updated_at: 100 }]);
        } else if (name === "delete") {
          assert.deepEqual(chapterRows.map((row) => ({ ...row })), [{ id: "ch-1", label: "削除前", updated_at: 100 }]);
        } else {
          assert.equal(chapterRows.length, 0);
        }
        assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM notification_outbox").get().count, 0);
        assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM static_rebuild_queue").get().count, 0);
        assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM audit_logs").get().count, 0);
        sqlite.close();
      });
    }
  }
}
