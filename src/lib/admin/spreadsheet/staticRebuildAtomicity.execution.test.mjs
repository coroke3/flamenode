import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx =
  process.env.FLAMENODE_SPREADSHEET_REBUILD_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_SPREADSHEET_REBUILD_EXECUTION: "1",
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
  const mutation = (label, apply) => ({ label, apply, _prepare: makePrepare });
  const generated = (query) => {
    const sequel = { sql: String(query), params: [] };
    return {
      query,
      getQuery: () => sequel,
      _prepare: () => ({
        getQuery: () => sequel,
        stmt: { bind: () => ({}) },
      }),
    };
  };

  test("queue書込み失敗はSpreadsheet本体・preview nonce・監査を同時にrollbackする", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE spreadsheet_rows (id TEXT PRIMARY KEY);
      CREATE TABLE spreadsheet_import_runs (nonce TEXT PRIMARY KEY, consumed_at INTEGER);
      CREATE TABLE static_rebuild_queue (id TEXT PRIMARY KEY);
      CREATE TABLE audit_logs (id TEXT PRIMARY KEY);
      INSERT INTO spreadsheet_import_runs VALUES ('nonce-1', NULL);
    `);

    const statements = [
      mutation("data", (db) =>
        db.prepare("INSERT INTO spreadsheet_rows VALUES ('row-1')").run(),
      ),
      mutation("nonce", (db) =>
        db
          .prepare(
            "UPDATE spreadsheet_import_runs SET consumed_at = 100 WHERE nonce = 'nonce-1'",
          )
          .run(),
      ),
      mutation("queue", (db) =>
        db.prepare("INSERT INTO static_rebuild_queue VALUES ('queue-1')").run(),
      ),
    ];

    const db = {
      select: (projection) => ({
        from: () => {
          const query = {
            leftJoin: () => query,
            where: () => ({ get: async () => undefined }),
          };
          if (projection === undefined) return query;
          return query;
        },
      }),
      run: (query) => generated(query),
      batch: async (items) => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          for (const item of items) {
            if (typeof item.apply !== "function") continue;
            item.apply(sqlite);
            if (item.label === "queue") throw new Error("injected:queue");
          }
          sqlite.exec("COMMIT");
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
        return [];
      },
    };

    await assert.rejects(
      mutateWithAudit(db, {
        mutationStatements: statements,
        expectedMutationChanges: [1, 1, 1],
        audits: [
          {
            table_name: "videos",
            target_id: "row-1",
            operation: "CREATE",
            before: null,
            after: { id: "row-1" },
            actor_user_id: "admin-1",
          },
          {
            table_name: "spreadsheet_import_runs",
            target_id: "nonce-1",
            operation: "UPDATE",
            before: { nonce: "nonce-1", consumed_at: null },
            after: { nonce: "nonce-1", consumed_at: 100 },
            actor_user_id: "admin-1",
          },
        ],
      }),
      /injected:queue/,
    );

    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM spreadsheet_rows").get()
        .count,
      0,
    );
    assert.equal(
      sqlite
        .prepare(
          "SELECT consumed_at FROM spreadsheet_import_runs WHERE nonce = 'nonce-1'",
        )
        .get().consumed_at,
      null,
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM static_rebuild_queue").get()
        .count,
      0,
    );
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count,
      0,
    );
    sqlite.close();
  });
}
