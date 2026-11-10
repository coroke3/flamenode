import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";
import {
  EVENT_GROUP_OPTION_PAGE_SIZE,
  MAX_EVENT_GROUP_ID_LENGTH,
  adminEventGroupOptionsRoutes,
  escapeEventGroupLikeTerm,
  parseEventGroupOptionCursor,
} from "../src/routes/admin/eventGroups.ts";

const admin = { id: "admin-1", role: "admin", is_banned: 0 };
function setup({
  user = admin, rows = [], failure = false,
  tosAccepted = 1, tosReaccept = 0, tosMissing = false, tosFailure = false,
  settingsMissing = false, settingsFailure = false,
  operationMode = "normal", disabledFeatures = "[]", mounted = false,
  exceptionUntil = null, exceptionFeatures = null,
} = {}) {
  const calls = [];
  const guardCalls = [];
  const db = {
    prepare(statement) {
      const isSearch = statement.includes("FROM events e");
      const call = { statement, params: [] };
      (isSearch ? calls : guardCalls).push(call);
      return {
        bind(...params) {
          call.params = params;
          return {
            async first() {
              if (statement.includes('FROM "user" u')) {
                if (tosFailure || settingsFailure) throw new Error("private gate lookup failure");
                return tosMissing ? null : {
                  is_tos_accepted: tosAccepted, terms_reaccept_required: tosReaccept,
                  operation_mode: settingsMissing ? null : operationMode,
                  disabled_features_json: settingsMissing ? null : disabledFeatures,
                  cost_guard_exception_until: exceptionUntil,
                  cost_guard_exception_features_json: exceptionFeatures,
                };
              }
              throw new Error("unexpected test read");
            },
            async all() {
              if (!isSearch) throw new Error("unexpected list read");
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
  if (mounted) {
    // Use the real admin router with only session resolution substituted.
    app.route("/api/admin", createAdminRoutes({ session: async (_c, next) => next() }));
  } else {
    app.route("/", adminEventGroupOptionsRoutes);
  }
  const get = (query = "groupId=g1") => app.request(
    new Request("https://example.com" + (mounted ? "/api/admin/event-groups/event-options" : "/event-options") + "?" + query),
    undefined,
    { DB: db },
  );
  return { get, calls, guardCalls };
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

test("SA-025: CURRENT write-side ToS and admin_event_create CostGuard also gate GET", async () => {
  for (const [label, config, expectedStatus] of [
    ["tos declined", { tosAccepted: 0 }, 403],
    ["tos reaccept", { tosReaccept: 1 }, 403],
    ["user deleted", { tosMissing: true }, 401],
    ["user DB outage", { tosFailure: true }, 503],
    ["cost mode", { operationMode: "maintenance" }, 503],
    ["feature disabled", { disabledFeatures: '["admin_event_create"]' }, 503],
    ["settings missing", { settingsMissing: true }, 503],
    ["settings outage", { settingsFailure: true }, 503],
  ]) {
    const { get, calls, guardCalls } = setup(config);
    const response = await get();
    assert.equal(response.status, expectedStatus, label);
    assert.deepEqual(await response.json(), {
      ok: false, message: "イベント候補の取得に失敗しました。もう一度お試しください。",
    }, label);
    assert.equal(response.headers.get("cache-control"), "private, no-store", label);
    assert.equal(calls.length, 0, label + ": denied before candidate SELECT");
    assert.ok(guardCalls.length >= 1, label);
  }
});

test("SA-025: mounted admin GET retains session, ToS and CostGuard fences", async () => {
  const ok = setup({ mounted: true });
  const success = await ok.get();
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { ok: true, options: [], nextCursor: null });
  assert.equal(ok.calls.length, 1);
  assert.equal(ok.guardCalls.length, 1);

  for (const config of [
    { mounted: true, user: null },
    { mounted: true, user: { ...admin, role: "moderator" } },
    { mounted: true, tosAccepted: 0 },
    { mounted: true, disabledFeatures: '["admin_event_create"]' },
  ]) {
    const { get, calls } = setup(config);
    const denied = await get();
    assert.ok([401, 403, 503].includes(denied.status));
    assert.equal(denied.headers.get("cache-control"), "private, no-store");
    assert.equal(calls.length, 0);
  }
});

test("SA-025: authorized search reads ToS, CostGuard, then one bounded candidate page", async () => {
  const { get, calls, guardCalls } = setup();
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(guardCalls.length, 1, "S2: one combined user/CostGuard read");
  assert.match(guardCalls[0].statement, /FROM "user" u/);
  assert.match(guardCalls[0].statement, /JOIN "system_settings" s/);
});

test("SA-025: a valid feature exception preserves CURRENT override without extra D1 reads", async () => {
  const { get, calls, guardCalls } = setup({
    operationMode: "maintenance", disabledFeatures: '["admin_event_create"]',
    exceptionUntil: Math.floor(Date.now() / 1000) + 3600,
    exceptionFeatures: '["admin_event_create"]',
  });
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(guardCalls.length, 1);
});

test("SA-025: malformed input is rejected before candidate SELECT without echoing cursor", async () => {
  const { get, calls } = setup();
  for (const query of [
    "groupId=",
    "groupId=g1&q=" + "a".repeat(65),
    "groupId=" + "g".repeat(MAX_EVENT_GROUP_ID_LENGTH + 1),
    "groupId=g1&cursor=" + encodeURIComponent(JSON.stringify({
      updatedAt: 4, id: "x".repeat(MAX_EVENT_GROUP_ID_LENGTH + 1),
    })),
    "groupId=g1&cursor=%7Bbad",
    "groupId=g1&cursor=" + encodeURIComponent(JSON.stringify({ updatedAt: 3.5, id: "abc" })),
    "groupId=g1&cursor=" + encodeURIComponent(JSON.stringify({ updatedAt: 5, id: "" })),
    "groupId=g1&cursor=" + encodeURIComponent(JSON.stringify({ updatedAt: -1, id: "abc" })),
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
  assert.deepEqual(parseEventGroupOptionCursor(JSON.stringify({
    updatedAt: 4, id: "x".repeat(MAX_EVENT_GROUP_ID_LENGTH),
  })), { updatedAt: 4, id: "x".repeat(MAX_EVENT_GROUP_ID_LENGTH) });
  assert.throws(() => parseEventGroupOptionCursor("[]"), /cursor_invalid/);
});

test("SA-025: malformed search never consumes the combined admin D1 gate read", async () => {
  const { get, calls, guardCalls } = setup();
  for (const input of [
    "groupId=",
    "groupId=g1&q=" + "a".repeat(65),
    "groupId=" + "g".repeat(MAX_EVENT_GROUP_ID_LENGTH + 1),
    "groupId=g1&cursor=%7Bbad",
    "groupId=g1&cursor=" + encodeURIComponent(JSON.stringify({ updatedAt: 1, id: "" })),
  ]) {
    const response = await get(input);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(guardCalls.length, 0, "malformed requests must not consume scarce D1 reads");
  assert.equal(calls.length, 0, "malformed requests must not reach candidate SQL");
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

test("SA-025: generated cursor accepts legacy IDs longer than 64 characters", async () => {
  const longId = "v".repeat(96);
  const rows = Array.from({ length: 81 }, (_, n) => ({
    id: n === 79 ? longId : "event-" + String(n).padStart(3, "0"),
    title: "Name " + n,
    start_time: null,
    updated_at: 2000 - n,
  }));
  const { get, calls } = setup({ rows });
  const first = await get();
  assert.equal(first.status, 200);
  const page = await first.json();
  assert.equal(page.options.length, 80);
  assert.deepEqual(JSON.parse(page.nextCursor), { updatedAt: 1921, id: longId });
  const second = await get("groupId=g1&cursor=" + encodeURIComponent(page.nextCursor));
  assert.equal(second.status, 200);
  assert.deepEqual(calls[1].params, ["g1", 1921, 1921, longId, 81]);
});

test("SA-025: legacy row whose cursor exceeds limits fails closed", async () => {
  const rows = Array.from({ length: 81 }, (_, n) => ({
    id: n === 79 ? "v".repeat(MAX_EVENT_GROUP_ID_LENGTH + 1) : "event-" + String(n).padStart(3, "0"),
    title: "Name " + n,
    start_time: null,
    updated_at: 2000 - n,
  }));
  const response = await setup({ rows }).get();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    message: "イベント候補の取得に失敗しました。もう一度お試しください。",
  });
});

test("SA-025: JSON-escaped continuation cursor over 200 characters fails closed", async () => {
  // 100 backslashes fit the ID cap but expand to 200 JSON characters.
  const escapedId = "\\".repeat(100);
  assert.ok(escapedId.length <= MAX_EVENT_GROUP_ID_LENGTH);
  assert.ok(JSON.stringify({ updatedAt: 1921, id: escapedId }).length > 200);
  const rows = Array.from({ length: 81 }, (_, n) => ({
    id: n === 79 ? escapedId : "event-" + String(n).padStart(3, "0"),
    title: "Name " + n,
    start_time: null,
    updated_at: 2000 - n,
  }));
  const { get, calls } = setup({ rows });
  const response = await get();
  assert.equal(response.status, 503);
  assert.equal(calls.length, 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    message: "イベント候補の取得に失敗しました。もう一度お試しください。",
  });
});

test("SA-025: source-parity cursor JSON with no extra fields and bounded exact limit", async () => {
  const idAtCursor = "n".repeat(128);
  const nearBoundCursor = JSON.stringify({ updatedAt: 1921, id: idAtCursor });
  assert.ok(nearBoundCursor.length <= 200);
  assert.deepEqual(parseEventGroupOptionCursor(nearBoundCursor), { updatedAt: 1921, id: idAtCursor });
  // A caller with a cursor too long is rejected rather than reaching candidate SQL.
  const denied = setup();
  const res = await denied.get("groupId=g1&cursor=" + encodeURIComponent("z".repeat(201)));
  assert.equal(res.status, 400);
  assert.equal(denied.calls.length, 0);
  // A valid 128-character cursor can still seek, without any SQL interpolation.
  const accepted = setup();
  const response = await accepted.get("groupId=g1&cursor=" + encodeURIComponent(nearBoundCursor));
  assert.equal(response.status, 200);
  assert.deepEqual(accepted.calls[0].params, ["g1", 1921, 1921, idAtCursor, 81]);
});

test("SA-025: real SQLite pagination accepts 96-character legacy event ID", async () => {
  const { db, sqlite, stats } = createAdminD1();
  try {
    seedBase(sqlite);
    sqlite.exec("CREATE TABLE event_group_events (event_group_id TEXT, event_id TEXT)");
    for (let n = 0; n < 83; n++) {
      seedEvent(sqlite, {
        id: n === 79 ? "v".repeat(96) : "item-" + String(n).padStart(3, "0"),
        title: "Candidate " + n,
        updated_at: 1000 - n,
      });
    }
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user", admin);
      c.set("sessionState", "user");
      await next();
    });
    app.route("/api/admin", createAdminRoutes({ session: async (_c, next) => next() }));
    const page = async (cursor) => {
      const params = new URLSearchParams({ groupId: "grp-1" });
      if (cursor) params.set("cursor", cursor);
      const response = await app.request(
        new Request("https://example.com/api/admin/event-groups/event-options?" + params.toString()),
        undefined, { DB: db },
      );
      assert.equal(response.status, 200);
      return response.json();
    };
    const first = await page(null);
    assert.equal(first.options.length, 80);
    assert.ok(first.nextCursor);
    assert.equal(first.options[79].id, "v".repeat(96));
    assert.deepEqual(JSON.parse(first.nextCursor), { updatedAt: 921, id: "v".repeat(96) });
    const second = await page(first.nextCursor);
    assert.deepEqual(second.options.map((v) => v.id), ["item-080", "item-081", "item-082"]);
    assert.equal(second.nextCursor, null);
    assert.equal(stats.batches, 0, "read-only legacy cursor must not mutate D1");
  } finally {
    sqlite.close();
  }
});

test("SA-025: real SQLite D1 rejects LIKE wildcard injection and excludes existing members", async () => {
  const { db, sqlite, stats } = createAdminD1();
  try {
    seedBase(sqlite);
    sqlite.exec("CREATE TABLE event_group_events (event_group_id TEXT, event_id TEXT)");
    seedEvent(sqlite, { id: "e-percent", title: "Course 100%", updated_at: 900 });
    seedEvent(sqlite, { id: "e-underscore", title: "Course 100_", updated_at: 800 });
    seedEvent(sqlite, { id: "e-other", title: "Course 100X", updated_at: 700 });
    seedEvent(sqlite, { id: "e-member", title: "Course 100%", updated_at: 1000 });
    sqlite.prepare("INSERT INTO event_group_events (event_group_id, event_id) VALUES (?, ?)")
      .run("grp-1", "e-member");

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user", admin);
      c.set("sessionState", "user");
      await next();
    });
    app.route("/api/admin", createAdminRoutes({ session: async (_c, next) => next() }));
    const search = async (q) => {
      const response = await app.request(
        new Request("https://example.com/api/admin/event-groups/event-options?groupId=grp-1&q=" +
          encodeURIComponent(q)),
        undefined, { DB: db },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      return response.json();
    };
    assert.deepEqual((await search("Course 100%")).options.map((item) => item.id), ["e-percent"]);
    assert.deepEqual((await search("Course 100_")).options.map((item) => item.id), ["e-underscore"]);
    assert.deepEqual((await search("Course 100")).options.map((item) => item.id),
      ["e-percent", "e-underscore", "e-other"]);
    assert.equal(stats.batches, 0, "candidate GET must never write D1");
  } finally {
    sqlite.close();
  }
});

test("SA-025: real SQLite stable cursor uses DESC timestamp and ASC ID tie-break", async () => {
  const { db, sqlite, stats } = createAdminD1();
  try {
    seedBase(sqlite);
    sqlite.exec("CREATE TABLE event_group_events (event_group_id TEXT, event_id TEXT)");
    for (let n = 0; n < 83; n++) {
      seedEvent(sqlite, {
        id: "item-" + String(n).padStart(3, "0"),
        title: "Candidate " + n,
        updated_at: 1000 - Math.floor(n / 2),
      });
    }
    sqlite.prepare("INSERT INTO event_group_events (event_group_id, event_id) VALUES (?, ?)")
      .run("grp-1", "item-000");
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user", admin);
      c.set("sessionState", "user");
      await next();
    });
    app.route("/api/admin", createAdminRoutes({ session: async (_c, next) => next() }));
    const page = async (cursor) => {
      const q = new URLSearchParams({ groupId: "grp-1" });
      if (cursor) q.set("cursor", cursor);
      const response = await app.request(new Request(
        "https://example.com/api/admin/event-groups/event-options?" + q.toString(),
      ), undefined, { DB: db });
      assert.equal(response.status, 200);
      return response.json();
    };
    const first = await page(null);
    assert.equal(first.options.length, 80);
    assert.ok(first.nextCursor);
    assert.deepEqual(first.options.slice(0, 3).map((v) => v.id),
      ["item-001", "item-002", "item-003"]);
    assert.equal(first.options[79].id, "item-080");
    assert.deepEqual(JSON.parse(first.nextCursor), { updatedAt: 960, id: "item-080" });
    const second = await page(first.nextCursor);
    assert.deepEqual(second.options.map((v) => v.id), ["item-081", "item-082"]);
    assert.equal(second.nextCursor, null);
    assert.equal(stats.batches, 0);
  } finally {
    sqlite.close();
  }
});

test("SA-025: real SQLite latest-major ToS and CostGuard use one combined gate read", async () => {
  const { db, sqlite, stats } = createAdminD1();
  try {
    seedBase(sqlite);
    sqlite.exec("CREATE TABLE event_group_events (event_group_id TEXT, event_id TEXT)");
    seedEvent(sqlite, { id: "ev-public", title: "Visible" });
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user", admin);
      c.set("sessionState", "user");
      await next();
    });
    app.route("/api/admin", createAdminRoutes({ session: async (_c, next) => next() }));
    const get = async () => app.request(new Request(
      "https://example.com/api/admin/event-groups/event-options?groupId=grp-1",
    ), undefined, { DB: db });

    const first = await get();
    assert.equal(first.status, 200);
    assert.equal(stats.reads, 2, "one gate and one candidate query; S4 would add one session read");
    sqlite.prepare("INSERT INTO terms_versions (id, severity, published_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("major-2", "major", 200, 200);
    const beforeTos = stats.reads;
    const reaccept = await get();
    assert.equal(reaccept.status, 403);
    assert.equal(stats.reads - beforeTos, 1, "ToS denial skips the candidate query");
    sqlite.prepare('UPDATE "user" SET accepted_terms_version_id = ? WHERE id = ?')
      .run("major-2", "admin-1");
    const accepted = await get();
    assert.equal(accepted.status, 200);
    sqlite.prepare("UPDATE system_settings SET disabled_features_json = ? WHERE id = ?")
      .run('["admin_event_create"]', "default");
    const beforeCost = stats.reads;
    const blocked = await get();
    assert.equal(blocked.status, 503);
    assert.equal(stats.reads - beforeCost, 1, "CostGuard denial skips the candidate query");
    sqlite.prepare(
      "UPDATE system_settings SET cost_guard_exception_until = ?, cost_guard_exception_features_json = ? WHERE id = ?",
    ).run(Math.floor(Date.now() / 1000) + 3600, '["admin_event_create"]', "default");
    assert.equal((await get()).status, 200, "an active feature exception overrides disabled flag");
    assert.equal(stats.batches, 0);
  } finally {
    sqlite.close();
  }
});
