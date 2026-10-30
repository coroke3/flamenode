import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx } from "./support/personalHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { Hono } = await import("hono");
  const { adminEventGroupsRoutes, normalizeAdminEventGroupType, ADMIN_EVENT_GROUPS_LIMIT } =
    await import("../src/routes/adminRead/eventGroups.ts");

  function fixture() {
    const queries = [];
    const db = {
      prepare(sql) {
        return {
          bind(...values) {
            queries.push({ sql, values });
            return { all: async () => ({ results: [
              { id: "grp", name: "Group", slug: "group", group_type: "series",
                visibility_status: "public", sort_order: 0, event_count: 2 },
            ] }) };
          },
        };
      },
    };
    const app = new Hono();
    // Isolated route test: the parent /api/admin-read router owns the
    // authenticated admin session guard and was verified in MIG-0625.
    app.route("/groups", adminEventGroupsRoutes);
    return {
      queries,
      get: async (params) => {
        const response = await app.request("https://example.test/groups?" + params, undefined, { DB: db });
        assert.equal(response.status, 200);
        return response.json();
      },
    };
  }

  test("admin event group type accepts only the five explicitly defined categories", () => {
    for (const allowed of ["series", "genre", "related", "collection", "other"]) {
      assert.equal(normalizeAdminEventGroupType(allowed), allowed);
    }
    for (const unknown of [undefined, "", "Series", "all", "constructor",
      "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
      assert.equal(normalizeAdminEventGroupType(unknown), "any");
    }
  });

  test("prototype properties cannot inject a bogus group_type SQL predicate", async () => {
    for (const value of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
      const { get, queries } = fixture();
      const body = await get("type=" + encodeURIComponent(value));
      assert.equal(body.type, "any", value);
      assert.equal(body.visibility, "any");
      assert.equal(body.groups[0].event_count, 2);
      assert.equal(queries.length, 1);
      assert.doesNotMatch(queries[0].sql, /g\.group_type = \?/);
      assert.deepEqual(queries[0].values, [ADMIN_EVENT_GROUPS_LIMIT]);
    }
  });

  test("recognized values retain the parameter-bound SQL filter and pagination cap", async () => {
    const { get, queries } = fixture();
    const response = await get("type=series&visibility=public");
    assert.equal(response.type, "series");
    assert.equal(response.visibility, "public");
    assert.match(queries[0].sql, /g\.group_type = \?/);
    assert.match(queries[0].sql, /g\.visibility_status = \?/);
    assert.deepEqual(queries[0].values, ["public", "series", 100]);
  });

  test("invalid type retains an otherwise valid visibility filter", async () => {
    const { get, queries } = fixture();
    const result = await get("type=constructor&visibility=private");
    assert.equal(result.type, "any");
    assert.equal(result.visibility, "private");
    assert.deepEqual(queries[0].values, ["private", 100]);
    assert.doesNotMatch(queries[0].sql, /g\.group_type = \?/);
  });
}
