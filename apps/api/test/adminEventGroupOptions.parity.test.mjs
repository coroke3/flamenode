import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  EVENT_GROUP_OPTION_PAGE_SIZE,
  adminEventGroupOptionsRoutes,
  escapeEventGroupLikeTerm,
  parseEventGroupOptionCursor,
} from "../src/routes/admin/eventGroups.ts";

const admin = { id: "admin-1", role: "admin", is_banned: 0 };
function setup({ user = admin, rows = [], failure = false } = {}) {
  const calls = [];
  const db = {
    prepare(statement) {
      const call = { statement, params: [] };
      calls.push(call);
      return {
        bind(...params) {
          call.params = params;
          return {
            async all() {
              if (failure) throw new Error("SQL error: secret binding");
              return { results: rows };
            },
          };
        },
      };
    },
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", user);
    c.set("sessionState", user ? "user" : "none");
    await next();
  });
  app.route("/", adminEventGroupOptionsRoutes);
  const get = (query = "groupId=g1") => app.request(
    new Request("https://example.com/event-options?" + query),
    undefined,
    { DB: db },
  );
  return { get, calls };
}

test("SA-025: only authenticated admin may search, including banned denial", async () => {
  for (const [user, status, code] of [
    [null, 401, "unauthorized"],
    [{ ...admin, role: "moderator" }, 403, "forbidden"],
    [{ ...admin, is_banned: 1 }, 403, "account_disabled"],
  ]) {
    const { get, calls } = setup({ user });
    const response = await get();
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, code);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(calls.length, 0);
  }
});

test("SA-025: malformed input fails before D1 and never echoes the cursor", async () => {
  const { get, calls } = setup();
  for (const query of [
    "groupId=",
    "groupId=g1&q=" + "a".repeat(65),
    "groupId=g1&cursor=%7Bbad",
    "groupId=g1&cursor=" + encodeURIComponent(JSON.stringify({ updatedAt: 3.5, id: "abc" })),
    "groupId=g1&cursor=" + encodeURIComponent(JSON.stringify({ updatedAt: 5, id: "" })),
    "groupId=g1&cursor=" + encodeURIComponent("x".repeat(201)),
  ]) {
    const response = await get(query);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false,
      message: "イベント候補の取得に失敗しました。もう一度お試しください。",
    });
  }
  assert.equal(calls.length, 0);
  assert.equal(parseEventGroupOptionCursor(null), null);
  assert.throws(() => parseEventGroupOptionCursor("[]"), /cursor_invalid/);
});

test("SA-025: escaping and cursor seek use bound values in CURRENT order", async () => {
  const { get, calls } = setup();
  const cursor = JSON.stringify({ updatedAt: 173, id: "ev-4" });
  const term = "a%b_c\\d";
  const response = await get(
    "groupId=%20group-1%20&q=" + encodeURIComponent(" " + term + " ") +
      "&cursor=" + encodeURIComponent(cursor),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, options: [], nextCursor: null });
  assert.equal(calls.length, 1);
  const { statement, params } = calls[0];
  assert.match(statement, /NOT EXISTS \(SELECT 1 FROM event_group_events/);
  assert.match(statement, /e\.title LIKE \? ESCAPE/);
  assert.match(statement, /e\.updated_at < \? OR \(e\.updated_at = \? AND e\.id > \?\)/);
  assert.match(statement, /ORDER BY e\.updated_at DESC, e\.id ASC LIMIT \?/);
  assert.deepEqual(params, [
    "group-1",
    "%" + escapeEventGroupLikeTerm(term) + "%",
    173, 173, "ev-4", EVENT_GROUP_OPTION_PAGE_SIZE + 1,
  ]);
  assert.equal(escapeEventGroupLikeTerm(term), "a\\%b\\_c\\\\d");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("SA-025: 81st row only indicates continuation; 80 options and stable cursor", async () => {
  const rows = Array.from({ length: 81 }, (_, n) => ({
    id: "event-" + String(n).padStart(3, "0"),
    title: "Name " + n,
    start_time: n === 1 ? null : 1000 + n,
    updated_at: 2000 - n,
  }));
  const { get, calls } = setup({ rows });
  const response = await get();
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.ok, true);
  assert.equal(page.options.length, 80);
  assert.deepEqual(page.options[1], { id: "event-001", title: "Name 1", start_time: null });
  assert.ok(page.options.every((option) => !("updated_at" in option)));
  assert.deepEqual(JSON.parse(page.nextCursor), { updatedAt: 1921, id: "event-079" });
  assert.deepEqual(calls[0].params, ["g1", 81]);
});

test("SA-025: DB failure returns generic 503 without query/SQL leakage", async () => {
  const { get, calls } = setup({ failure: true });
  const response = await get("groupId=g1&q=PRIVATE");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    message: "イベント候補の取得に失敗しました。もう一度お試しください。",
  });
  assert.equal(calls.length, 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
