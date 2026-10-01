import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
  const {
    buildPendingXIdMergeRevertInsert,
    buildPendingXIdRequestInsert,
  } = await import("./xidPendingInsert.ts");

  function row(id) {
    return {
      id,
      request_type: "new_link",
      requested_by_auth_user_id: "auth-user-1",
      requested_x_id: "creator_x",
      source_x_user_id: null,
      target_x_user_id: null,
      parent_request_id: null,
      restore_snapshot_json: null,
      revert_deadline_at: null,
      status: "pending",
      requested_at: 100,
      updated_at: 100,
    };
  }

  async function compile(rowValue) {
    let captured;
    const db = drizzle(async (...query) => {
      captured = query;
      return { rows: [] };
    });
    await db.run(buildPendingXIdRequestInsert(rowValue));
    assert.ok(captured?.[0]);
    return captured[0];
  }

  function compilePrepared(statement) {
    return new SQLiteSyncDialect().sqlToQuery(statement);
  }

  function makeDatabase() {
    const sqlite = new DatabaseSync(":memory:");
    for (const name of readdirSync(new URL("../../../migrations", import.meta.url)).filter((entry) => entry.endsWith(".sql")).sort()) {
      sqlite.exec(readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8"));
    }
    sqlite.exec("PRAGMA foreign_keys = OFF");
    return sqlite;
  }

  test("同一user・target・requestの条件付きINSERTは同時重複を1件にする", async () => {
    const sqlite = makeDatabase();
    const first = sqlite.prepare(await compile(row("xreq-1"))).run();
    const second = sqlite
      .prepare(
        await compile({
          ...row("xreq-2"),
          request_type: "existing_link",
        }),
      )
      .run();
    assert.equal(first.changes, 1);
    assert.equal(second.changes, 0);
    assert.equal(
      sqlite.prepare(
        "SELECT COUNT(*) AS count FROM x_identity_requests WHERE requested_by_auth_user_id = 'auth-user-1' AND status = 'pending'",
      ).get().count,
      1,
    );
    sqlite.close();
  });

  test("条件付きINSERTはpending上限5件を原子的に守る", async () => {
    const sqlite = makeDatabase();
    for (let index = 0; index < 5; index += 1) {
      sqlite.prepare(await compile({ ...row(`existing-${index}`), requested_x_id: `creator_${index}` })).run();
    }
    const sixth = sqlite.prepare(await compile(row("xreq-sixth"))).run();
    assert.equal(sixth.changes, 0);
    assert.equal(
      sqlite.prepare(
        "SELECT COUNT(*) AS count FROM x_identity_requests WHERE requested_by_auth_user_id = 'auth-user-1' AND status = 'pending'",
      ).get().count,
      5,
    );
    sqlite.close();
  });

  test("revert childの条件付きINSERTは巨大snapshotを複製せず同一親へ1件だけ作る", () => {
    const sqlite = makeDatabase();
    sqlite.prepare(`
      INSERT INTO x_identity_requests (
        id, request_type, requested_by_auth_user_id, requested_x_id,
        source_x_user_id, target_x_user_id, parent_request_id,
        restore_snapshot_json, revert_deadline_at, status, requested_at, updated_at
      ) VALUES (?, 'merge', ?, NULL, ?, ?, NULL, ?, ?, 'done', ?, ?)
    `).run(
      "merge-parent",
      "auth-user-1",
      "old_name",
      "current_name",
      JSON.stringify({ payload: "x".repeat(100_000) }),
      500,
      100,
      100,
    );
    const revertRow = {
      ...row("revert-1"),
      request_type: "revert_merge",
      requested_x_id: null,
      source_x_user_id: "old_name",
      target_x_user_id: "current_name",
      parent_request_id: "merge-parent",
      restore_snapshot_json: null,
      revert_deadline_at: 500,
    };
    const first = compilePrepared(buildPendingXIdMergeRevertInsert({
      row: revertRow,
      parentUpdatedAt: 100,
    }));
    const second = compilePrepared(buildPendingXIdMergeRevertInsert({
      row: { ...revertRow, id: "revert-2" },
      parentUpdatedAt: 100,
    }));
    assert.ok(new TextEncoder().encode(first.sql).byteLength < 10_000);
    assert.equal(first.params.includes("x".repeat(100_000)), false);
    assert.equal(sqlite.prepare(first.sql).run(...first.params).changes, 1);
    assert.equal(sqlite.prepare(second.sql).run(...second.params).changes, 0);
    assert.equal(
      sqlite.prepare(`
        SELECT COUNT(*) AS count FROM x_identity_requests
        WHERE parent_request_id = 'merge-parent'
          AND request_type = 'revert_merge'
          AND status IN ('pending', 'approved', 'done')
      `).get().count,
      1,
    );
    sqlite.close();
  });
}
