import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed } from "./support/adminReadSeed.mjs";

// Exercise the same Hono admin-read routes and real SQLite migrations as MIG-0625.
// A huge page is an untrusted URL value, not an SQL or database availability failure.
if (runUnderRootTsx(import.meta.url)) {
  const { clampPage } = await import("../src/routes/adminRead/shared.ts");
  const { app } = await import("../src/app.ts");

  test("MIG-0625: normal page, fractional page, and invalid page retain CURRENT behavior", () => {
    for (const [raw, expectedPage] of [
      [undefined, 1], ["", 1], ["0", 1], ["-1", 1], ["oops", 1],
      ["Infinity", 1], ["2.9", 2], ["2", 2], ["0x10", 16],
    ]) {
      const result = clampPage(raw, 50);
      assert.deepEqual(result, { page: expectedPage, pageSize: 50, offset: (expectedPage - 1) * 50 });
    }
  });

  test("MIG-0625: unsafe and overflowing page offsets fail closed to page one", () => {
    for (const raw of [
      "1e308",
      "9007199254740991",
      "9007199254740992",
      "100000000000000",
      "999999999999999999999999999999999999",
    ]) {
      assert.deepEqual(clampPage(raw, 50), { page: 1, pageSize: 50, offset: 0 }, raw);
    }
    // Still support a large but exactly representable, nonoverflowing offset.
    const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / 50) + 1;
    const result = clampPage(String(maxPage), 50);
    assert.equal(result.page, maxPage);
    assert.ok(Number.isSafeInteger(result.offset));
  });

  test("MIG-0625: huge query page returns a healthy first page for both admin users and videos", async () => {
    const sqlite = createSqlite();
    seed(sqlite);
    async function get(path) {
      const d1 = createD1(sqlite);
      const response = await app.request(path, {
        method: "GET",
        headers: cookie("tok-root"),
      }, { DB: d1, AUTH_SECRET: "test-secret" });
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(d1.stats.writes, 0);
      assert.ok(d1.stats.statements <= 3, "migration D1 query limit");
      assert.ok(d1.stats.maxBinds <= 100, "migration D1 bind limit");
      return body;
    }
    for (const endpoint of ["/api/admin-read/users", "/api/admin-read/videos"]) {
      const first = await get(endpoint + "?page=1");
      for (const invalid of ["1e308", "9007199254740991", "100000000000000"]) {
        const actual = await get(endpoint + "?page=" + encodeURIComponent(invalid));
        assert.equal(actual.degraded, false, endpoint + " " + invalid);
        assert.equal(actual.paging.page, 1, endpoint + " " + invalid);
        assert.deepEqual(actual, first, endpoint + " " + invalid);
      }
      const second = await get(endpoint + "?page=2");
      assert.equal(second.degraded, false);
      assert.equal(second.paging.page, 2);
      assert.notDeepEqual(second, first);
    }
  });
}
