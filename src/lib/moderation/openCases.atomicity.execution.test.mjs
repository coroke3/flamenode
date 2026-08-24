import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { planVoidModerationCaseOpen } = await import("./openCases.ts");

  function setup() {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE videos (
        id TEXT PRIMARY KEY,
        visibility_status TEXT NOT NULL
      );
      CREATE TABLE video_moderation_cases (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        case_type TEXT NOT NULL,
        status TEXT NOT NULL,
        public_reason TEXT,
        private_note TEXT,
        due_at INTEGER,
        locked_until INTEGER,
        attempt_count INTEGER NOT NULL,
        related_x_user_id TEXT,
        created_by_user_id TEXT NOT NULL,
        resolved_by_user_id TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL
      );
      INSERT INTO videos VALUES ('video-1', 'pending');
    `);
    return sqlite;
  }

  async function compileOpenCasePlan() {
    const db = drizzle(async () => ({ rows: [] }));
    const plan = await planVoidModerationCaseOpen(db, {
      videoId: "video-1",
      caseType: "void",
      publicReason: "void reason",
      privateNote: null,
      actorUserId: "admin-1",
      now: 100,
      auditContext: "test",
    });
    const statement = plan.statements[0];
    assert.ok(statement && typeof statement.getSQL === "function");
    return {
      query: db.dialect.sqlToQuery(statement.getSQL()),
      expectedChanges: plan.expectedChanges[0],
    };
  }

  function insertExistingOpenCase(sqlite) {
    sqlite.prepare(`
      INSERT INTO video_moderation_cases (
        id, video_id, case_type, status, public_reason, private_note,
        due_at, locked_until, attempt_count, related_x_user_id,
        created_by_user_id, resolved_by_user_id, created_at, resolved_at
      ) VALUES (?, ?, ?, 'open', NULL, NULL, NULL, NULL, 0, NULL, ?, NULL, ?, NULL)
    `).run("vmc-direct", "video-1", "void", "admin-2", 101);
  }

  function executeStatusBatch(sqlite, plan) {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const videoUpdate = sqlite.prepare(
        "UPDATE videos SET visibility_status = 'voided' WHERE id = 'video-1' AND visibility_status = 'pending'",
      ).run();
      assert.equal(videoUpdate.changes, 1);

      const caseInsert = sqlite
        .prepare(plan.query.sql)
        .run(...plan.query.params);
      if (caseInsert.changes !== plan.expectedChanges) {
        throw new Error("open_case_cas_conflict");
      }

      sqlite.prepare("INSERT INTO audit_logs VALUES (?, ?)").run(
        "audit-status",
        "video-1",
      );
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  test("stale void plan fails closed after another path creates the open case", async () => {
    const sqlite = setup();
    const stalePlan = await compileOpenCasePlan();

    insertExistingOpenCase(sqlite);

    assert.throws(
      () => executeStatusBatch(sqlite, stalePlan),
      /open_case_cas_conflict/,
    );
    assert.equal(
      sqlite.prepare("SELECT visibility_status FROM videos WHERE id = 'video-1'").get()
        .visibility_status,
      "pending",
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM video_moderation_cases").get()
        .count,
      1,
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count, 0);
    sqlite.close();
  });

  test("fresh void plan inserts one open case and commits the status batch", async () => {
    const sqlite = setup();
    const plan = await compileOpenCasePlan();

    executeStatusBatch(sqlite, plan);

    assert.equal(
      sqlite.prepare("SELECT visibility_status FROM videos WHERE id = 'video-1'").get()
        .visibility_status,
      "voided",
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM video_moderation_cases").get()
        .count,
      1,
    );
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count, 1);
    sqlite.close();
  });
}
