import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { resolvePermissionSubjectXUserId } from "../src/video/permissionSubject.ts";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE x_users (id TEXT PRIMARY KEY, approval_status TEXT);
    CREATE TABLE x_user_aliases (x_user_id TEXT NOT NULL, alias_x_id TEXT NOT NULL,
      PRIMARY KEY (x_user_id, alias_x_id));
    CREATE TABLE x_user_account_links (
      auth_user_id TEXT NOT NULL, x_user_id TEXT NOT NULL,
      PRIMARY KEY (auth_user_id, x_user_id)
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
              const stmt = sqlite.prepare(query);
              stmt.setReturnArrays(true);
              try { return stmt.all(...params).map(row => [...row]); }
              finally { stmt.setReturnArrays(false); }
            },
          };
        },
      };
    },
  };
  return { sqlite, queries, db: drizzle(binding, { schema }) };
}

test("SA-082 no explicit X ID: only an approved singleton link can be selected", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(`
      INSERT INTO x_users VALUES ('alice', 'approved'), ('pending', 'pending');
      INSERT INTO x_user_account_links VALUES ('owner','alice'), ('owner','pending');
    `);
    assert.deepEqual(
      await resolvePermissionSubjectXUserId(f.db, null, "owner"),
      { ok: true, xUserId: "alice" },
    );
    f.sqlite.exec(`
      INSERT INTO x_users VALUES ('bob', 'approved');
      INSERT INTO x_user_account_links VALUES ('owner', 'bob');
    `);
    const many = await resolvePermissionSubjectXUserId(f.db, null, "owner");
    assert.equal(many.ok, false);
    assert.match(many.message, /複数の X ID/);
  } finally { f.sqlite.close(); }
});

test("SA-082 explicit alias resolves canonical X and checks the supplied auth user's approved link", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(`
      INSERT INTO x_users VALUES ('alice','approved'), ('bob','approved');
      INSERT INTO x_user_aliases VALUES ('alice','oldalice');
      INSERT INTO x_user_account_links VALUES ('owner','alice'), ('other','bob');
    `);
    assert.deepEqual(
      await resolvePermissionSubjectXUserId(f.db, "@OLDALICE", "owner"),
      { ok: true, xUserId: "alice" },
    );
    const denied = await resolvePermissionSubjectXUserId(f.db, "@OLDALICE", "other");
    assert.equal(denied.ok, false);
    assert.match(denied.message, /紐づいていません/);
    assert.deepEqual(
      await resolvePermissionSubjectXUserId(f.db, "bob", null),
      { ok: true, xUserId: "bob" },
    );
  } finally { f.sqlite.close(); }
});

test("SA-083 rejects nonexistent and rejected explicit X targets without creating pending rows", async () => {
  const f = fixture();
  try {
    f.sqlite.exec("INSERT INTO x_users VALUES ('denied','rejected')");
    for (const candidate of ["missing", "denied", " @ "]) {
      const denied = await resolvePermissionSubjectXUserId(f.db, candidate, null);
      assert.equal(denied.ok, false);
      assert.match(denied.message, /一意な正本/);
    }
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 1);
  } finally { f.sqlite.close(); }
});

test("SA-082 empty auth and X subject fails without executing any D1 statement", async () => {
  const f = fixture();
  try {
    assert.deepEqual(await resolvePermissionSubjectXUserId(f.db, null, null), {
      ok: false, message: "共同編集者の X ID が必要です。",
    });
    assert.equal(f.queries.length, 0);
  } finally { f.sqlite.close(); }
});

test("SA-082 ambiguous aliases and live canonical-alias collisions fail closed", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(`
      INSERT INTO x_users VALUES ('alice','approved'), ('bob','approved'), ('collision','approved');
      INSERT INTO x_user_aliases VALUES
        ('alice','shared'), ('bob','shared'),
        ('alice','collision');
    `);
    for (const candidate of ["shared", "collision"]) {
      const denied = await resolvePermissionSubjectXUserId(f.db, candidate, null);
      assert.equal(denied.ok, false);
      assert.match(denied.message, /一意な正本/);
    }
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 3);
  } finally { f.sqlite.close(); }
});
