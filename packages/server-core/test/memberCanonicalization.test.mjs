import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import { canonicalizeVideoMemberInputs } from "../src/video/memberCanonicalization.ts";

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE x_users (id TEXT PRIMARY KEY, approval_status TEXT);" +
    "CREATE TABLE x_user_aliases (x_user_id TEXT NOT NULL, alias_x_id TEXT NOT NULL," +
    "PRIMARY KEY (x_user_id, alias_x_id));"
  );
  const queries = [];
  const d1 = {
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
  return { sqlite, queries, db: drizzle(d1, { schema }) };
}

function member(name, xid = "", extra = {}) {
  return { name, x_user_id: xid, role: "", comment: "", chapters: [], ...extra };
}

async function assertReject(f, members, error) {
  const before = f.sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n;
  await assert.rejects(canonicalizeVideoMemberInputs(f.db, members), error);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, before);
}

test("MIG-0650 U03d-2i: empty and non-X member inputs do not read D1", async () => {
  const f = fixture();
  try {
    const inputs = [member("No X"), member("spaces", "@  ")];
    const result = await canonicalizeVideoMemberInputs(f.db, inputs);
    assert.equal(f.queries.length, 0);
    assert.equal(result.canonicalByXId.size, 0);
    assert.deepEqual(result.lookupXIds, []);
    assert.deepEqual(result.members.map(x => x.x_user_id), ["", ""]);
    assert.deepEqual(inputs.map(x => x.x_user_id), ["", "@  "]);
  } finally { f.sqlite.close(); }
});

test("MIG-0650 U03d-2i: unknown X is allowed as pending canonical, normalized to lower-case", async () => {
  const f = fixture();
  try {
    const value = await canonicalizeVideoMemberInputs(f.db, [member("Ghost", "@GhOst")]);
    assert.deepEqual(value.members.map(x => x.x_user_id), ["ghost"]);
    assert.deepEqual(value.lookupXIds, ["ghost"]);
    assert.equal(value.canonicalByXId.get("ghost"), "ghost");
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 0);
  } finally { f.sqlite.close(); }
});

test("MIG-0650 U03d-2i: submitted old alias resolves to live canonical", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(
      "INSERT INTO x_users VALUES ('new_name','approved');" +
      "INSERT INTO x_user_aliases VALUES ('new_name','old_name');"
    );
    const r = await canonicalizeVideoMemberInputs(f.db, [member("Alias", "@OLD_NAME")]);
    assert.deepEqual(r.members.map(x => x.x_user_id), ["new_name"]);
    assert.deepEqual(r.lookupXIds, ["new_name", "old_name"]);
    assert.equal(r.canonicalByXId.get("old_name"), "new_name");
    assert.equal(r.canonicalByXId.get("new_name"), "new_name");
  } finally { f.sqlite.close(); }
});

test("MIG-0650 U03d-2i: canonical input includes inverse aliases only for carry lookups", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(
      "INSERT INTO x_users VALUES ('new_name','approved'), ('unrelated','approved');" +
      "INSERT INTO x_user_aliases VALUES ('new_name','old_name'), ('unrelated','old_other');"
    );
    const r = await canonicalizeVideoMemberInputs(f.db, [member("Current", "new_name")]);
    assert.deepEqual(r.members.map(x => x.x_user_id), ["new_name"]);
    assert.deepEqual(r.lookupXIds, ["new_name", "old_name"]);
    assert.equal(r.canonicalByXId.get("old_name"), "new_name");
    assert.equal(r.canonicalByXId.has("old_other"), false);
  } finally { f.sqlite.close(); }
});

test("MIG-0650 U03d-2i: ambiguous inverse alias rejects even valid canonical input", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(
      "INSERT INTO x_users VALUES ('new_name','approved'), ('other','approved');" +
      "INSERT INTO x_user_aliases VALUES ('new_name','shared'), ('other','shared');"
    );
    await assertReject(f, [member("Current", "new_name")], /video_member_alias_resolution_invalid/);
  } finally { f.sqlite.close(); }
});

test("MIG-0650 U03d-2i: rejected direct identity and missing alias target fail closed", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(
      "INSERT INTO x_users VALUES ('rejected','rejected');" +
      "INSERT INTO x_user_aliases VALUES ('missing','old_missing');"
    );
    await assertReject(f, [member("Rejected", "rejected")], /video_member_x_user_resolution_invalid/);
    await assertReject(f, [member("Missing target", "old_missing")], /video_member_x_user_resolution_invalid/);
  } finally { f.sqlite.close(); }
});

test("MIG-0650 U03d-2i: alias and canonical duplicate fail the same write", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(
      "INSERT INTO x_users VALUES ('new_name','approved');" +
      "INSERT INTO x_user_aliases VALUES ('new_name','old_name');"
    );
    await assertReject(f, [
      member("Alias", "old_name"), member("Canonical", "new_name"),
    ], /video_member_duplicate_x_user_id/);
  } finally { f.sqlite.close(); }
});

test("MIG-0650 U03d-2i: invalid canonical handle is rejected before member D1 write", async () => {
  const f = fixture();
  try {
    await assertReject(f, [member("long", "a".repeat(21))], /video_member_x_user_id_invalid/);
    await assertReject(f, [member("invalid", "bad-handle")], /video_member_x_user_id_invalid/);
  } finally { f.sqlite.close(); }
});

test("MIG-0650 U03d-2i: live canonical/alias collision cannot pick another principal", async () => {
  const f = fixture();
  try {
    f.sqlite.exec(
      "INSERT INTO x_users VALUES ('new_name','approved'), ('collision','approved');" +
      "INSERT INTO x_user_aliases VALUES ('new_name','collision');"
    );
    await assertReject(f, [member("Collision", "collision")], /video_member_x_user_resolution_invalid/);
  } finally { f.sqlite.close(); }
});

test("MIG-0650 U03d-2i: shared resolver drives CURRENT Next, retaining CAS", async () => {
  const legacy = await readFile(new URL("../src/video/replaceVideoMembers.ts", import.meta.url), "utf8");
  const mutations = await readFile(new URL("../src/video/memberWriteMutationBatch.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/memberCanonicalization"], "./src/video/memberCanonicalization.ts");
  assert.match(legacy, /from "\.\/memberCanonicalization\.ts"/);
  assert.match(legacy, /canonicalizeVideoMemberInputs\(db, args\.members\)/);
  assert.match(legacy, /from "\.\/memberWriteMutationBatch\.ts"/);
  assert.match(mutations, /buildVideoMemberSetGuardSql/);
  assert.match(mutations, /buildHiddenCarryRowsGuardSql/);
  assert.doesNotMatch(legacy, /function isUnsafeXUserResolution/);
  assert.doesNotMatch(legacy, /async function canonicalizeMemberInputs/);
});
