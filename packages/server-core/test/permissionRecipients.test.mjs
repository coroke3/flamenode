import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { loadNotifiableRecipientLinks } from "../src/video/permissionRecipients.ts";

function makeDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE "user" (id TEXT PRIMARY KEY, is_notification_enabled INTEGER);
    CREATE TABLE x_users (id TEXT PRIMARY KEY, approval_status TEXT);
    CREATE TABLE x_user_account_links (x_user_id TEXT, auth_user_id TEXT);
  `);
  const reads = [];
  const binding = {
    prepare(query) {
      reads.push(query);
      return {
        bind(...params) {
          return {
            async all() {
              return { results: sqlite.prepare(query).all(...params).map(row => ({ ...row })) };
            },
            async raw() {
              // Drizzle D1's select .all() decodes rows through the raw
              // array interface, not only the D1 all() object interface.
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

test("SA-082..084 notification links: empty input causes no D1 read", async () => {
  const { sqlite, db, reads } = makeDb();
  try {
    assert.deepEqual(await loadNotifiableRecipientLinks(db, []), []);
    assert.equal(reads.length, 0);
  } finally {
    sqlite.close();
  }
});

test("SA-082..084 notification links: only approved X identities and opted-in users", async () => {
  const { sqlite, db, reads } = makeDb();
  try {
    const addUser = sqlite.prepare('INSERT INTO "user" (id, is_notification_enabled) VALUES (?, ?)');
    addUser.run("enabled", 1);
    addUser.run("disabled", 0);
    addUser.run("unset", null);
    const addX = sqlite.prepare("INSERT INTO x_users (id, approval_status) VALUES (?, ?)");
    addX.run("alice", "approved");
    addX.run("bob", "rejected");
    addX.run("carol", "pending");
    addX.run("dave", "approved");
    addX.run("eve", "approved");
    addX.run("frank", "approved");
    const addLink = sqlite.prepare("INSERT INTO x_user_account_links (x_user_id, auth_user_id) VALUES (?, ?)");
    addLink.run("alice", "enabled");
    addLink.run("bob", "enabled");
    addLink.run("carol", "enabled");
    addLink.run("dave", "disabled");
    addLink.run("eve", "unset");
    addLink.run("frank", "deleted-account");
    const actual = await loadNotifiableRecipientLinks(db, [
      "ALICE", "ALICE", "bob", "carol", "dave", "eve", "frank", "absent",
    ]);
    assert.deepEqual(actual, [{ x_user_id: "alice", auth_user_id: "enabled" }]);
    assert.equal(reads.length, 1, "one bounded recipient query for the batch");
    assert.match(reads[0], /json_each/i, "IDs are passed as a bound JSON array");
    assert.match(reads[0], /lower\(/i, "CURRENT case-insensitive selection retained");
  } finally {
    sqlite.close();
  }
});

test("SA-082..084 notification links: distinct approved auth links are not silently dropped", async () => {
  const { sqlite, db } = makeDb();
  try {
    sqlite.exec(`
      INSERT INTO "user" VALUES ('one', 1), ('two', 1);
      INSERT INTO x_users VALUES ('alice', 'approved');
      INSERT INTO x_user_account_links VALUES ('alice', 'one'), ('alice', 'two');
    `);
    const rows = await loadNotifiableRecipientLinks(db, ["alice", "alice"]);
    assert.deepEqual(rows.map(row => row.auth_user_id).sort(), ["one", "two"]);
  } finally {
    sqlite.close();
  }
});
