import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const {
    executeVideoAtomicWritePlan,
    inspectVideoAtomicWritePlanBudget,
    VideoAtomicPlanBudgetError,
  } = await import("./atomicWritePlan.ts");

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

  const budgetPlan = (statementCount, auditCount) => ({
    statements: Array.from({ length: statementCount }, () => ({ kind: "mutation" })),
    expectedChanges: Array.from({ length: statementCount }, () => 1),
    audits: Array.from({ length: auditCount }, (_, index) => ({
      table_name: "videos",
      target_id: `video-${index}`,
      operation: "UPDATE",
      before: { id: `video-${index}` },
      after: { id: `video-${index}` },
      actor_user_id: "actor-1",
    })),
  });

  test("D1境界は15 statement・16 auditでちょうど50 queryに収まる", () => {
    const budget = inspectVideoAtomicWritePlanBudget(budgetPlan(15, 16));
    assert.equal(budget.totalQueryCount, 50);
    assert.equal(budget.withinLimit, true);
  });

  test("最小の単独投稿は5 statement・3 auditで24 queryに収まる", () => {
    const budget = inspectVideoAtomicWritePlanBudget(budgetPlan(5, 3));
    assert.deepEqual(
      {
        statements: budget.mutationStatementCount,
        assertions: budget.mutationAssertionCount,
        auditChunks: budget.auditChunkCount,
        preparation: budget.preparationQueryCount,
        reserved: budget.reservedCallerQueryCount,
        total: budget.totalQueryCount,
      },
      { statements: 5, assertions: 5, auditChunks: 1, preparation: 2, reserved: 10, total: 24 },
    );
  });

  test("代表的な投稿はqueue既存行混在時も15 statement・15 auditで50 queryに収まる", () => {
    const budget = inspectVideoAtomicWritePlanBudget(budgetPlan(15, 15));
    assert.deepEqual(
      {
        statements: budget.mutationStatementCount,
        assertions: budget.mutationAssertionCount,
        auditChunks: budget.auditChunkCount,
        preparation: budget.preparationQueryCount,
        reserved: budget.reservedCallerQueryCount,
        total: budget.totalQueryCount,
      },
      { statements: 15, assertions: 15, auditChunks: 4, preparation: 2, reserved: 10, total: 50 },
    );
    assert.equal(budget.withinLimit, true);
  });

  test("全上限同時指定の22 statement・53 auditは84 queryとして事前拒否する", async () => {
    const plan = budgetPlan(22, 53);
    const budget = inspectVideoAtomicWritePlanBudget(plan);
    assert.equal(budget.totalQueryCount, 84);
    assert.equal(budget.withinLimit, false);
    let batchCalled = false;
    await assert.rejects(
      executeVideoAtomicWritePlan({ batch: async () => { batchCalled = true; } }, plan),
      (error) =>
        error instanceof VideoAtomicPlanBudgetError &&
        error.budget.totalQueryCount === budget.totalQueryCount,
    );
    assert.equal(batchCalled, false);
  });

  test("16 statement・16 auditは52 queryとなり境界直後で事前拒否する", () => {
    const budget = inspectVideoAtomicWritePlanBudget(budgetPlan(16, 16));
    assert.equal(budget.totalQueryCount, 52);
    assert.equal(budget.withinLimit, false);
  });

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
              if (item.label === failAt) throw new Error(`injected:${failAt}`);
              continue;
            }
            generated += 1;
            // 5件の変更件数assertionの次が、監査INSERTと監査assertionになる。
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
    _prepare: makePrepare,
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
