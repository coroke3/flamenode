import test from "node:test";
import assert from "node:assert/strict";
import { searchAdminVideoMemberXUsers } from "../.test-dist/apps/ops/src/api/adminVideoMemberSuggestions.js";

const result = (overrides = {}) => ({
  items: [
    { id: "alice", x_name: "Alice", score: 10, matchedBy: "xid_exact" },
  ],
  query: "al", limit: 20, offset: 0, nextOffset: null,
  hasMore: false, hint: null, source: "v2",
  ...overrides,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0730 U02e: exact RH-019 query uses same-origin no-store authenticated GET and forwards abort", async () => {
  const controller = new AbortController();
  let seen;
  const search = async (path, init) => {
    seen = { path, init };
    return json(result());
  };
  const found = await searchAdminVideoMemberXUsers("  @あ l  ", 4, controller.signal, search);
  assert.equal(seen.path, "/api/internal/x-users/search?q=%40%E3%81%82%20l&limit=20&offset=4");
  assert.equal(seen.init.method, "GET");
  assert.equal(seen.init.credentials, "same-origin");
  assert.equal(seen.init.cache, "no-store");
  assert.deepEqual(seen.init.headers, { accept: "application/json" });
  assert.equal(seen.init.signal, controller.signal);
  assert.deepEqual(found, {
    items: [{ id: "alice", x_name: "Alice", score: 10, matchedBy: "xid_exact" }],
    nextOffset: null, hasMore: false, hint: null,
  });
});

test("MIG-0730 U02e: 401/403/404/503 and malformed 200 reject rather than report no matches", async () => {
  const controller = new AbortController();
  for (const status of [401, 403, 404, 503]) {
    await assert.rejects(
      searchAdminVideoMemberXUsers("al", 0, controller.signal, async () => json({ error: "secret" }, status)),
      /member_suggestions_unavailable/,
    );
  }
  await assert.rejects(
    searchAdminVideoMemberXUsers("al", 0, controller.signal, async () =>
      new Response("<html>unauthorized</html>", { status: 200 })),
    /member_suggestions_unavailable/,
  );
});

test("MIG-0730 U02e: reject oversized, malformed, non-finite and cross-type candidates", async () => {
  const bad = [
    result({ items: Array.from({ length: 21 }, (_, i) => ({ id: "a" + i, x_name: "a" })) }),
    result({ items: [{ id: "", x_name: "A" }] }),
    result({ items: [{ id: "x", x_name: 123 }] }),
    result({ items: [{ id: "x", x_name: "X", score: "bad" }] }),
    result({ items: [{ id: "x", x_name: "X", score: null }] }),
    result({ nextOffset: -1 }),
    result({ nextOffset: "12" }),
    result({ hasMore: "true" }),
    result({ hint: 10 }),
    result({ items: "invalid" }),
    [],
  ];
  for (const payload of bad) {
    await assert.rejects(
      searchAdminVideoMemberXUsers("al", 0, new AbortController().signal, async () => json(payload)),
      /member_suggestions_unavailable/,
    );
  }
});

test("MIG-0730 U02e: pre-flight rejects invalid query, unsafe offsets and UTF-16 before network", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return json(result()); };
  for (const [q, offset] of [
    ["", 0], ["   ", 0], ["a".repeat(65), 0], ["\uD800", 0],
    ["a", -1], ["a", 5001], ["a", NaN], ["a", 0.5], ["a", Infinity],
  ]) {
    await assert.rejects(
      searchAdminVideoMemberXUsers(q, offset, new AbortController().signal, fetchFn),
      /member_suggestions_unavailable/,
    );
  }
  assert.equal(calls, 0);
});

test("MIG-0730 U02e: abort before or after network response never returns stale private suggestions", async () => {
  const aborted = new AbortController();
  aborted.abort();
  let calls = 0;
  await assert.rejects(
    searchAdminVideoMemberXUsers("al", 0, aborted.signal, async () => {
      calls++;
      return json(result());
    }),
    /member_suggestions_unavailable/,
  );
  assert.equal(calls, 0);
  const controller = new AbortController();
  await assert.rejects(
    searchAdminVideoMemberXUsers("al", 0, controller.signal, async () => {
      controller.abort();
      return json(result({ items: [{ id: "secret", x_name: "SECRET" }] }));
    }),
    /member_suggestions_unavailable/,
  );
});

test("MIG-0730 U02e: 20 rows, valid empty V2 refine and pagination preserve Hono contract", async () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ id: "user_" + i, x_name: null }));
  const a = await searchAdminVideoMemberXUsers("al", 2, new AbortController().signal,
    async () => json(result({ items: twenty, nextOffset: 22, hasMore: true, hint: "refine" })));
  assert.equal(a.items.length, 20);
  assert.deepEqual(a.items[0], { id: "user_0", x_name: null });
  assert.equal(a.hasMore, true);
  assert.equal(a.nextOffset, 22);
  const b = await searchAdminVideoMemberXUsers("al", 0, new AbortController().signal,
    async () => json(result({ items: [], nextOffset: null, hasMore: true, hint: "refine" })));
  assert.deepEqual(b, { items: [], hasMore: true, nextOffset: null, hint: "refine" });
});
