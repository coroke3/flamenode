import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { loadPermissionGrantProfiles } from "../src/video/permissionProfiles.ts";

function makeDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE x_users (id TEXT PRIMARY KEY, approval_status TEXT)");
  const reads = [];
  const binding = {
    prepare(query) {
      reads.push(query);
      return {
        bind(...params) {
          return {
            async raw() {
              const statement = sqlite.prepare(query);
              statement.setReturnArrays(true);
              try {
                return statement.all(...params).map(row => [...row]);
              } finally {
                statement.setReturnArrays(false);
              }
            },
          };
        },
      };
    },
  };
  return { sqlite, reads, db: drizzle(binding, { schema }) };
}

test("MIG-0650 X-profile loader does not query D1 for empty grant input", async () => {
  const { sqlite, reads, db } = makeDb();
  try {
    assert.deepEqual(await loadPermissionGrantProfiles(db, []), []);
    assert.equal(reads.length, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0650 X-profile loader casefolds grant IDs and preserves rejected status", async () => {
  const { sqlite, reads, db } = makeDb();
  try {
    sqlite.exec(`
      INSERT INTO x_users VALUES ('alice', 'approved'), ('bob', 'rejected'),
        ('carol', 'pending'), ('other', 'approved');
    `);
    const result = await loadPermissionGrantProfiles(db, ["ALICE", "BOB", "carol"]);
    assert.deepEqual(
      result.map(row => ({ ...row })).sort((a, b) => a.id.localeCompare(b.id)),
      [
        { id: "alice", approval_status: "approved" },
        { id: "bob", approval_status: "rejected" },
        { id: "carol", approval_status: "pending" },
      ],
    );
    assert.equal(reads.length, 1);
    assert.match(reads[0], /json_each/);
  } finally {
    sqlite.close();
  }
});

test("MIG-0650 X-profile loader binds hostile IDs without expanding the result", async () => {
  const { sqlite, reads, db } = makeDb();
  try {
    sqlite.exec("INSERT INTO x_users VALUES ('alice', 'approved'), ('bob', 'rejected')");
    const hostile = "alice') OR 1=1 --";
    assert.deepEqual(await loadPermissionGrantProfiles(db, [hostile]), []);
    assert.equal(reads.length, 1);
    assert.doesNotMatch(reads[0], /OR 1=1/);
  } finally {
    sqlite.close();
  }
});
