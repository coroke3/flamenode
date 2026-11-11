import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { preparePermissionWrite } from "../src/video/permissionPreparation.ts";

const args = {
  videoId: "v1", actorId: "actor", now: 1700000000,
  notify: true, makeMemberId: () => "vm1",
};

test("SA-084 shared preflight treats empty intents as a terminal no-op without D1", async () => {
  const result = await preparePermissionWrite(null, { ...args, intents: [] });
  assert.deepEqual(result, {
    kind: "terminal",
    result: {
      ok: true, message: "変更対象がありません。",
      granted: [], revoked: [], unchanged: 0,
    },
  });
});

test("SA-084 shared preflight rejects invalid empty X ID before D1 access", async () => {
  const result = await preparePermissionWrite(null, {
    ...args, intents: [{ x_user_id: " @ ", display_name: "Invalid", intent: "on" }],
  });
  assert.equal(result.kind, "error");
  assert.ok(result.message);
});

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE x_users (id TEXT PRIMARY KEY, approval_status TEXT);
    CREATE TABLE x_user_aliases (alias_x_id TEXT PRIMARY KEY, x_user_id TEXT);
    CREATE TABLE video_members (
      id TEXT PRIMARY KEY, video_id TEXT, x_user_id TEXT, name TEXT,
      role TEXT, comment TEXT, order_index INTEGER, can_edit INTEGER,
      is_public_member INTEGER, edit_granted_by_auth_user_id TEXT,
      edit_granted_at INTEGER, edit_updated_at INTEGER
    );
  `);
  const queries = [];
  const binding = {
    prepare(query) {
      queries.push(query);
      return {
        bind(...params) {
          return {
            async raw() {
              const statement = sqlite.prepare(query);
              statement.setReturnArrays(true);
              try { return statement.all(...params).map(row => [...row]); }
              finally { statement.setReturnArrays(false); }
            },
          };
        },
      };
    },
  };
  return { sqlite, queries, db: drizzle(binding, { schema }) };
}

test("SA-084 shared preflight loads approved X and plans a bounded grant without executing DML", async () => {
  const f = fixture();
  try {
    f.sqlite.exec("INSERT INTO x_users VALUES ('alice', 'approved')");
    f.sqlite.exec("INSERT INTO video_members VALUES ('m1','v1','alice','Alice',NULL,NULL,0,0,1,NULL,NULL,NULL)");
    const result = await preparePermissionWrite(f.db, {
      ...args, intents: [{ x_user_id: "@ALICE", display_name: "Alice", intent: "on" }],
    });
    assert.equal(result.kind, "write_required");
    if (result.kind !== "write_required") return;
    assert.deepEqual(result.xids, ["alice"]);
    assert.deepEqual(result.plan.updateRows.map(row => [row.id, row.can_edit]), [["m1", 1]]);
    assert.equal(result.currentHiddenEditorCount, 0);
    assert.equal(f.sqlite.prepare("SELECT can_edit FROM video_members WHERE id='m1'").get().can_edit, 0);
    assert.ok(f.queries.every(q => /^\\s*(?:select|with)\\b/i.test(q)), "preflight must only read");
  } finally { f.sqlite.close(); }
});

test("SA-084 shared preflight rejects a rejected canonical X before member reads or writes", async () => {
  const f = fixture();
  try {
    f.sqlite.exec("INSERT INTO x_users VALUES ('blocked', 'rejected')");
    await assert.rejects(
      preparePermissionWrite(f.db, {
        ...args, intents: [{ x_user_id: "blocked", display_name: "Blocked", intent: "on" }],
      }),
      /video_permission_x_user_resolution_invalid:blocked/,
    );
    assert.ok(f.queries.length <= 2, "identity resolution only, before member/profile mutation reads");
    assert.equal(f.sqlite.prepare("SELECT approval_status FROM x_users WHERE id='blocked'").get().approval_status, "rejected");
  } finally { f.sqlite.close(); }
});
