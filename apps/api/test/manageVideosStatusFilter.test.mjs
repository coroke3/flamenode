import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed } from "./support/manageSeed.mjs";

// An actual Hono request over the same migrated SQLite schema as production.
// The CURRENT normalizeVideoVisibilityFilter uses an own-key Set; inheritance
// from Object.prototype must never be accepted as a video visibility status.
if (runUnderRootTsx(import.meta.url)) {
  const { app } = await import("../src/app.ts");

  const sqlite = createSqlite();
  seed(sqlite);

  async function get(filter, token = "tok-owner") {
    const d1 = createD1(sqlite);
    const query = filter === undefined ? "" : "?status=" + encodeURIComponent(filter);
    const response = await app.request(
      "/api/manage/events/evA/videos" + query,
      { method: "GET", headers: cookie(token) },
      { DB: d1, AUTH_SECRET: "test-secret" },
    );
    const body = await response.json();
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(d1.stats.writes, 0, "GET must never write");
    assert.ok(d1.stats.maxBinds <= 100, "migration D1 bind budget");
    assert.ok(d1.stats.statements <= 3, "migration D1 statement budget");
    return { status: response.status, body };
  }

  test("MIG-0624: inherited JavaScript keys normalize to CURRENT review filter", async () => {
    const expected = await get(undefined);
    assert.equal(expected.status, 200);
    assert.equal(expected.body.statusFilter, "review");
    assert.equal(expected.body.filterLabel, "審査待ち");
    assert.equal(expected.body.isReviewFilter, true);
    assert.ok(expected.body.rows.length > 0, "fixture includes pending videos");

    for (const raw of [
      "constructor", "__proto__", "toString", "valueOf", "hasOwnProperty",
      "isPrototypeOf", "propertyIsEnumerable", "toLocaleString",
      "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
      "not-a-filter",
    ]) {
      const actual = await get(raw);
      assert.equal(actual.status, 200, raw);
      assert.deepEqual(actual.body, expected.body, raw + " must not be an accepted status");
      assert.equal(typeof actual.body.filterLabel, "string", raw);
    }
  });

  test("MIG-0624: valid visibility groups, raw statuses and explicit all remain unchanged", async () => {
    for (const [filter, status, label, review] of [
      ["review", "review", "審査待ち", true],
      ["pending", "pending", "審査待ち", true],
      ["public", "public", "公開", false],
      ["private", "private", "非公開", false],
      ["closed", "closed", "無効", false],
      ["voided", "voided", "無効化", false],
      ["all", "", "すべて", false],
      ["", "", "すべて", false],
    ]) {
      const actual = await get(filter);
      assert.equal(actual.status, 200, filter);
      assert.equal(actual.body.statusFilter, status, filter);
      assert.equal(actual.body.filterLabel, label, filter);
      assert.equal(actual.body.isReviewFilter, review, filter);
    }
    assert.deepEqual((await get("constructor", "tok-admin")).body,
      (await get(undefined, "tok-admin")).body, "admin route is equally hardened");
  });

  test("MIG-0624: invalid keys never bypass event-scoped access control", async () => {
    for (const filter of [undefined, "constructor", "__proto__", "pending"]) {
      const denied = await get(filter, "tok-plain");
      assert.equal(denied.status, 404);
      assert.equal(denied.body.error, "Not Found");
    }
  });
}
