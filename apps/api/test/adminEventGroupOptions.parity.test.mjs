import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { dbMiddleware } from "../src/middleware/db.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../src/middleware/writeOrigin.ts";
import { EventGroupMutationBodySchema } from "@flamenode/contracts";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";
import {
  EVENT_GROUP_OPTION_PAGE_SIZE,
  MAX_EVENT_GROUP_ID_LENGTH,
  adminEventGroupOptionsRoutes,
  stagedEventGroupWriteRoutes,
  escapeEventGroupLikeTerm,
  parseEventGroupOptionCursor,
  planEventGroupCreateValues,
  planEventGroupUpdateValues,
  requireEventGroupMutationId,
  checkEventGroupUpdateCas,
  checkEventGroupSlugAvailable,
  EVENT_GROUP_ADD_MAX,
  normalizeEventGroupMembershipAdd,
  normalizeEventGroupMembershipRemove,
  planEventGroupMembershipAdd,
  planEventGroupMembershipWriteRows,
  planEventGroupMembershipRemove,
  planEventGroupMembershipDeleteBudget,
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

test("SA-030 U04: canonical audited D1 delete budget respects Free 50-query cap", () => {
  const one = planEventGroupMembershipDeleteBudget({
    callerQueryCount: 3, queueStatementCount: 1,
    auditEntryCount: 1, distinctActorCount: 1,
  });
  // 1 delete + 1 queue + 2 changes assertions + 2 audit statements
  // + 2 audit prep reads + 3 caller reads (S4 + identity + joined settings/snapshot) = 11.
  assert.deepEqual(one, { withinLimit: true, totalQueryCount: 11, limit: 50 });
  assert.deepEqual(planEventGroupMembershipDeleteBudget({
    callerQueryCount: 40, queueStatementCount: 1,
    auditEntryCount: 1, distinctActorCount: 1,
  }), { withinLimit: true, totalQueryCount: 48, limit: 50 });
  assert.deepEqual(planEventGroupMembershipDeleteBudget({
    callerQueryCount: 43, queueStatementCount: 1,
    auditEntryCount: 1, distinctActorCount: 1,
  }), { withinLimit: false, totalQueryCount: 51, limit: 50 });
  // SA-030 always audits exactly one deleted relation; it must reject a
  // misleading projection for 80 audit records rather than budget a different
  // operation and allow the writer to proceed.
  assert.deepEqual(planEventGroupMembershipDeleteBudget({
    callerQueryCount: 5, queueStatementCount: 1,
    auditEntryCount: 80, distinctActorCount: 1,
  }), { withinLimit: false, totalQueryCount: Infinity, limit: 50 });
  // The shared budget helper normalizes negative and NaN fields to zero;
  // this SA-030 entrypoint MUST deny invalid caller-supplied estimates.
  for (const invalid of [
    { callerQueryCount: -1 },
    { callerQueryCount: Number.NaN },
    { callerQueryCount: Number.POSITIVE_INFINITY },
    { callerQueryCount: 1.5 },
    { callerQueryCount: Number.MAX_SAFE_INTEGER + 1 },
    { queueStatementCount: -1 },
    { auditEntryCount: 0 },
    { distinctActorCount: 0 },
    { distinctActorCount: 2 },
  ]) {
    assert.deepEqual(planEventGroupMembershipDeleteBudget({
      callerQueryCount: 5, queueStatementCount: 1,
      auditEntryCount: 1, distinctActorCount: 1, ...invalid,
    }), { withinLimit: false, totalQueryCount: Infinity, limit: 50 });
  }
});

test("SA-029/030 U04: write projections keep CURRENT INSERT shape and delete CAS snapshot", () => {
  const added = planEventGroupMembershipWriteRows("grp-1", ["ev-b", "ev-a"], 1710000000);
  assert.deepEqual(added, [
    { event_group_id: "grp-1", event_id: "ev-b", relation_type: "member",
      created_at: 1710000000, updated_at: 1710000000 },
    { event_group_id: "grp-1", event_id: "ev-a", relation_type: "member",
      created_at: 1710000000, updated_at: 1710000000 },
  ]);
  assert.notStrictEqual(added[0], added[1], "each audit after snapshot must be independent");
  const ids80 = Array.from({ length: 80 }, (_, i) => "ev-" + i);
  assert.equal(planEventGroupMembershipWriteRows("grp-1", ids80, 0).length, 80);
  for (const [groupId, ids, now] of [
    ["", ["ev"], 1], ["grp-1", [], 1],
    ["grp-1", ["ev", "ev"], 1], ["grp-1", ["ev", " "], 1],
    ["grp-1", [" ev"], 1], ["grp-1", Array.from({ length: 81 }, (_, i) => "ev-" + i), 1],
    ["grp-1", ["ev"], -1], ["grp-1", ["ev"], 1.5],
    ["grp-1", ["ev"], Number.MAX_SAFE_INTEGER + 1],
  ]) {
    assert.throws(() => planEventGroupMembershipWriteRows(groupId, ids, now),
      /event_group_membership_plan_invalid/);
  }

  const relation = {
    event_group_id: "grp-1", event_id: "ev-a", relation_type: "primary",
    created_at: 1710000000, updated_at: 1710000001,
  };
  const remove = planEventGroupMembershipRemove("grp-1", "ev-a", relation);
  assert.deepEqual(remove, {
    ok: true, expectedUpdatedAt: 1710000001,
    before: relation,
  });
  assert.notStrictEqual(remove.before, relation, "full before snapshot must not alias caller row");
  assert.deepEqual(planEventGroupMembershipRemove("grp-1", "ev-a",
    { ...relation, relation_type: "related" }), {
    ok: true, expectedUpdatedAt: 1710000001,
    before: { ...relation, relation_type: "related" },
  }, "CURRENT removes all existing relation types, not just member");
  const noRelation = { ok: false, message: "イベントはグループに追加されていません。" };
  for (const bad of [null, undefined, { ...relation, event_group_id: "foreign" },
    { ...relation, event_id: "other" }, { ...relation, updated_at: -1 },
    { ...relation, updated_at: 1.5 }, { ...relation, created_at: -1 },
    { ...relation, relation_type: "invalid" }]) {
    assert.deepEqual(planEventGroupMembershipRemove("grp-1", "ev-a", bad), noRelation);
  }
  // This tests only projections; the future guarded route must still assert
  // exactly 1 DELETE change atomically with audit and queue statements.
});

test("SA-029 U04: post-read membership planner preserves CURRENT validation ordering", () => {
  const input = normalizeEventGroupMembershipAdd({
    groupId: " group ", eventIds: [" ev-b ", " ev-a ", " ev-c ", " ev-a "],
  });
  assert.equal(input.ok, true);
  assert.deepEqual(planEventGroupMembershipAdd(["ev-b", "ev-a", "ev-c"],
    ["ev-a", "ev-c", "ev-b"], ["ev-a"]), {
    ok: true, toAdd: ["ev-b", "ev-c"],
  });
  assert.deepEqual(planEventGroupMembershipAdd(["ev-a", "ev-b"],
    ["ev-a", "ev-b"], ["ev-a", "ev-b"]), {
    ok: false, message: "追加できるイベントがありません。",
  });
  assert.deepEqual(planEventGroupMembershipAdd(["ev-a", "ev-missing"],
    ["ev-a"], ["ev-a"]), {
    ok: false, message: "存在しないイベントは追加できません。",
  });
  assert.deepEqual(planEventGroupMembershipAdd(["ev-a"],
    ["ev-a", "unexpected"], []), {
    ok: false, message: "存在しないイベントは追加できません。",
  });
  // Two identical DB rows must not mask a missing requested event.
  // Neither may a duplicate row replace proof for a distinct event.
  assert.deepEqual(planEventGroupMembershipAdd(["ev-a", "ev-missing"],
    ["ev-a", "ev-a"], []), {
    ok: false, message: "存在しないイベントは追加できません。",
  });
  assert.deepEqual(planEventGroupMembershipAdd(["ev-a", "ev-b"],
    ["ev-a", "ev-a", "ev-b"], []), {
    ok: false, message: "存在しないイベントは追加できません。",
  });
  assert.deepEqual(planEventGroupMembershipAdd(["ev-a", "ev-b"],
    ["ev-b", "ev-a"], []), {
    ok: true, toAdd: ["ev-a", "ev-b"],
  });
  assert.deepEqual(planEventGroupMembershipAdd([], [], []), {
    ok: false, message: "存在しないイベントは追加できません。",
  });
  // Even an incorrectly wired handler that skips the input normalizer must
  // not be able to bypass the 80-unique-ID invariant or duplicate validation.
  for (const invalid of [
    ["ev-a", "ev-a"], [" ev-a"], [""],
    Array.from({ length: 81 }, (_, i) => "event-" + i),
  ]) {
    assert.deepEqual(planEventGroupMembershipAdd(invalid, invalid, []), {
      ok: false, message: "存在しないイベントは追加できません。",
    });
  }
  // Caller must not partially insert even when one requested event is absent.
  const valid80 = Array.from({ length: 80 }, (_, i) => "event-" + i);
  assert.deepEqual(planEventGroupMembershipAdd(valid80, [...valid80].reverse(), valid80.slice(0, 79)), {
    ok: true, toAdd: ["event-79"],
  });
  assert.deepEqual(planEventGroupMembershipAdd(valid80, valid80.slice(0, 79), valid80.slice(0, 79)), {
    ok: false, message: "存在しないイベントは追加できません。",
  });
});

test("SA-029 U04: unique-ID limit preserves CURRENT duplicate normalization", () => {
  // CURRENT de-duplicates before enforcing the 80-distinct-ID limit. Keep
  // duplicate-heavy inputs compatible without allocating filter/map arrays.
  const duplicates = Array.from({ length: 10000 }, () => "ev-1");
  assert.deepEqual(normalizeEventGroupMembershipAdd({
    groupId: "grp-1", eventIds: duplicates,
  }), { ok: true, groupId: "grp-1", eventIds: ["ev-1"] });

  const atLimit = normalizeEventGroupMembershipAdd({
    groupId: "grp-1", eventIds: Array.from({ length: 80 }, (_, i) => "ev-" + i),
  });
  assert.deepEqual(atLimit, {
    ok: true, groupId: "grp-1", eventIds: Array.from({ length: 80 }, (_, i) => "ev-" + i),
  });
  const overLimit = normalizeEventGroupMembershipAdd({
    groupId: "grp-1", eventIds: Array.from({ length: 81 }, (_, i) => "ev-" + i),
  });
  assert.deepEqual(overLimit, {
    ok: false,
    message: "一度に追加できるイベントは80件までです。分けて実行してください。",
  });
});

test("SA-029/030 U04: CURRENT membership input normalization and 80-ID bound", () => {
  assert.equal(EVENT_GROUP_ADD_MAX, 80);
  assert.deepEqual(normalizeEventGroupMembershipAdd({
    groupId: "  grp-1  ",
    eventIds: [" first ", "second", "", "first", null, 42, "  ", "second "],
  }), { ok: true, groupId: "grp-1", eventIds: ["first", "second"] });
  assert.deepEqual(normalizeEventGroupMembershipAdd({
    groupId: " g ", eventIds: Array.from({ length: 80 }, (_, i) => "ev-" + i),
  }), {
    ok: true, groupId: "g", eventIds: Array.from({ length: 80 }, (_, i) => "ev-" + i),
  });
  const tooMany = { ok: false,
    message: "一度に追加できるイベントは80件までです。分けて実行してください。" };
  assert.deepEqual(normalizeEventGroupMembershipAdd({
    groupId: "g", eventIds: Array.from({ length: 81 }, (_, i) => "ev-" + i),
  }), tooMany);
  assert.deepEqual(normalizeEventGroupMembershipAdd({
    groupId: "", eventIds: Array.from({ length: 81 }, (_, i) => "ev-" + i),
  }), tooMany, "CURRENT checks max before missing group");
  assert.deepEqual(normalizeEventGroupMembershipAdd({
    groupId: "g", eventIds: [...Array(81).fill("same"), " last "],
  }), { ok: true, groupId: "g", eventIds: ["same", "last"] });
  const noSelection = { ok: false, message: "追加するイベントを選択してください。" };
  for (const bad of [undefined, null, {}, { groupId: "g", eventIds: [42, null, " "] },
    { groupId: " ", eventIds: ["ev"] }, { groupId: 1, eventIds: ["ev"] }]) {
    assert.deepEqual(normalizeEventGroupMembershipAdd(bad), noSelection);
  }
  assert.deepEqual(normalizeEventGroupMembershipRemove({ groupId: " grp ", eventId: " ev " }), {
    ok: true, groupId: "grp", eventId: "ev",
  });
  const invalidRemove = { ok: false, message: "グループとイベントを指定してください。" };
  for (const bad of [undefined, null, {}, { groupId: "grp", eventId: "" },
    { groupId: " ", eventId: "ev" }, { groupId: 1, eventId: "ev" },
    { groupId: "grp", eventId: 3 }]) {
    assert.deepEqual(normalizeEventGroupMembershipRemove(bad), invalidRemove);
  }
});

test("SA-027 U03: CURRENT write preflight errors and CAS boundaries", () => {
  const build = (fields = {}) => EventGroupMutationBodySchema.parse({
    name: "Example", slug: "example", ...fields,
  });
  assert.deepEqual(requireEventGroupMutationId(build()), {
    ok: false, message: "ID が必要です。",
  });
  assert.deepEqual(requireEventGroupMutationId(build({ id: " grp-1 " })), { ok: true });
  assert.deepEqual(requireEventGroupMutationId(build({ id: "   " })), {
    ok: false, message: "ID が必要です。",
  });
  assert.deepEqual(checkEventGroupSlugAvailable(false), {
    ok: false, message: "このスラッグは既に使われています。",
  });
  assert.deepEqual(checkEventGroupSlugAvailable(true), { ok: true });
  for (const bad of [undefined, null, 0, 42, 42.5]) {
    assert.deepEqual(checkEventGroupUpdateCas(bad, 43), {
      ok: false,
      message: "他の操作で更新されています。再読み込みして確認してください。",
    });
  }
  assert.deepEqual(checkEventGroupUpdateCas(43, 43), { ok: true });
  assert.deepEqual(checkEventGroupUpdateCas(0, 0), { ok: true });
  // A preflight success does not guarantee DB write success: the atomic
  // UPDATE must still CAS on updated_at and check changes() in the D1 batch.
});

test("SA-026/027 U03: create/update projections preserve CURRENT invariants", () => {
  const input = EventGroupMutationBodySchema.parse({
    id: "  egrp-existing  ", name: "  Collection  ", slug: "  collection-1  ",
    description: "  ", group_type: "genre", icon_url: "  /icon.png  ",
    img_url: "  /image.png  ", accent_color: "  #abc  ", visibility_status: "private",
  });
  const now = 1730000000;
  assert.deepEqual(planEventGroupCreateValues(input, "egrp-new", now), {
    id: "egrp-new", name: "Collection", slug: "collection-1",
    description: null, group_type: "genre", icon_url: "/icon.png",
    img_url: null, accent_color: "#abc", visibility_status: "private",
    sort_order: 0, created_at: now, updated_at: now,
  });
  assert.deepEqual(planEventGroupUpdateValues(input, { sort_order: 27, updated_at: now + 40 }, now), {
    name: "Collection", slug: "collection-1",
    description: null, group_type: "genre", icon_url: "/icon.png",
    accent_color: "#abc", visibility_status: "private",
    sort_order: 27, updated_at: now + 41,
  });
  const newInput = EventGroupMutationBodySchema.parse({
    name: "New", slug: "new", sort_order: -123,
    description: "  desc  ", icon_url: null, accent_color: "",
  });
  const updated = planEventGroupUpdateValues(newInput, { sort_order: 27, updated_at: now - 100 }, now);
  assert.equal(updated.sort_order, -123);
  assert.equal(updated.updated_at, now);
  assert.equal(updated.description, "desc");
  assert.equal(updated.icon_url, null);
  assert.equal(updated.accent_color, null);
  assert.equal(Object.hasOwn(updated, "img_url"), false, "CURRENT update leaves img_url unchanged");
  assert.equal(Object.hasOwn(updated, "id"), false, "CURRENT update never overwrites id");
});

test("SA-026/027 U03: group mutation contract matches CURRENT form bounds and coercion", () => {
  const parsed = EventGroupMutationBodySchema.parse({
    id: "  grp-1  ", base_updated_at: "7",
    name: "  Sample Group  ", slug: "  sample-group  ",
    description: "  hello  ", group_type: "collection",
    icon_url: "  https://example.com/icon  ", img_url: "",
    accent_color: "#aBcD", visibility_status: "private",
    sort_order: "-9999", unrelated: "ignored by CURRENT z.object",
  });
  assert.deepEqual(parsed, {
    id: "grp-1", base_updated_at: 7,
    name: "Sample Group", slug: "sample-group",
    description: "hello", group_type: "collection",
    icon_url: "https://example.com/icon", img_url: "",
    accent_color: "#aBcD", visibility_status: "private", sort_order: -9999,
  });
  const defaults = EventGroupMutationBodySchema.parse({ name: "a", slug: "a" });
  assert.equal(defaults.group_type, "series");
  assert.equal(defaults.visibility_status, "public");
  assert.equal(defaults.sort_order, undefined, "CURRENT keeps optional sort_order absent");
  assert.equal(defaults.base_updated_at, undefined, "update handler must enforce CAS separately");
  assert.equal(EventGroupMutationBodySchema.parse({ name: "x", slug: "x", sort_order: 9999 }).sort_order, 9999);
  assert.equal(EventGroupMutationBodySchema.parse({ name: "x", slug: "x", base_updated_at: null }).base_updated_at, null);

  for (const bad of [
    {}, { name: "", slug: "x" },
    { name: "N".repeat(121), slug: "x" },
    { name: "x", slug: "UpperCase" }, { name: "x", slug: "x".repeat(65) },
    { name: "x", slug: "x", group_type: "unknown" },
    { name: "x", slug: "x", visibility_status: "hidden" },
    { name: "x", slug: "x", description: "d".repeat(2001) },
    { name: "x", slug: "x", icon_url: "u".repeat(501) },
    { name: "x", slug: "x", img_url: "u".repeat(501) },
    { name: "x", slug: "x", accent_color: "#GGG" },
    { name: "x", slug: "x", sort_order: 10000 },
    { name: "x", slug: "x", sort_order: -10000 },
    { name: "x", slug: "x", sort_order: 0.5 },
    { name: "x", slug: "x", base_updated_at: -1 },
    { name: "x", slug: "x", base_updated_at: 1.1 },
  ]) {
    assert.equal(EventGroupMutationBodySchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
  }
});

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

const STAGED_WRITE_SITE = "https://app.flamenode.example";
function stagedSa030Harness({ role = "admin", mutateAfterRead = false, settings = "normal" } = {}) {
  let changedAfterRead = false;
  const { db, sqlite, stats } = createAdminD1({
    onFirst: (statement, instance) => {
      if (mutateAfterRead && !changedAfterRead &&
          statement.includes("FROM system_settings AS s")) {
        changedAfterRead = true;
        instance.prepare(
          "UPDATE event_group_events SET updated_at = 201 WHERE event_group_id = ? AND event_id = ?",
        ).run("grp-1", "ev-1");
      }
    },
  });
  seedBase(sqlite, { role, settings });
  sqlite.exec(`
    CREATE TABLE event_groups (id TEXT PRIMARY KEY);
    CREATE TABLE event_group_events (
      event_group_id TEXT NOT NULL, event_id TEXT NOT NULL,
      relation_type TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, PRIMARY KEY (event_group_id, event_id)
    );
    INSERT INTO event_groups (id) VALUES ('grp-1');
    INSERT INTO event_group_events VALUES ('grp-1', 'ev-1', 'primary', 10, 20);
  `);
  const user = { ...admin, role };
  const opts = {
    loadSiteUrl: () => STAGED_WRITE_SITE,
    allowLocalPreview: () => false,
  };
  const app = new Hono();
  // Recreate the same parent admin origin/session/write/db order without
  // modifying the shared admin index or publishing the staged write route.
  app.use("*", originGuardMiddleware(opts));
  app.use("*", async (c, next) => {
    c.set("user", user);
    c.set("sessionState", "user");
    await next();
  });
  app.use("*", writeGuardMiddleware(opts));
  app.use("*", dbMiddleware);
  app.route("/api/admin/event-groups", stagedEventGroupWriteRoutes);
  const remove = (path = "/api/admin/event-groups/grp-1/events/ev-1",
                  origin = STAGED_WRITE_SITE) => app.request(
    new Request(STAGED_WRITE_SITE + path, {
      method: "DELETE", headers: { Origin: origin },
    }), undefined, { DB: db, NEXT_PUBLIC_SITE_URL: STAGED_WRITE_SITE },
  );
  const count = (table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return { sqlite, stats, remove, count };
}

test("SA-030 U04 staged: real SQLite DELETE, full restorable audit and queue are atomic", async () => {
  const h = stagedSa030Harness();
  try {
    const response = await h.remove();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, id: "grp-1" });
    assert.equal(h.count("event_group_events"), 0);
    assert.equal(h.count("audit_logs"), 1);
    assert.equal(h.count("static_rebuild_queue"), 1);
    const audit = h.sqlite.prepare("SELECT * FROM audit_logs").get();
    assert.equal(audit.table_name, "event_group_events");
    assert.equal(audit.target_id, "grp-1:ev-1");
    assert.equal(audit.operation, "DELETE");
    assert.equal(audit.retention_class, "restorable");
    assert.deepEqual(JSON.parse(audit.before_json), {
      event_group_id: "grp-1", event_id: "ev-1",
      relation_type: "primary", created_at: 10, updated_at: 20,
    });
    const queue = h.sqlite.prepare("SELECT target_type, target_id, reason FROM static_rebuild_queue").get();
    assert.deepEqual({ ...queue }, { target_type: "events_index", target_id: "global",
      reason: "event_group_member_remove" });
    assert.equal(h.stats.batches, 1);
    // The joined settings/relation snapshot replaces the standalone CostGuard
    // read. Real S4 adds one session SELECT: 2 observed + 1 session = 3.
    assert.equal(h.stats.reads, 2);
  } finally {
    h.sqlite.close();
  }
});

test("SA-030 U04 staged: joined CostGuard snapshot denies maintenance mode before mutation", async () => {
  const h = stagedSa030Harness({ settings: "maintenance" });
  try {
    const response = await h.remove();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, "maintenance_mode");
    assert.equal(h.count("event_group_events"), 1);
    assert.equal(h.count("audit_logs"), 0);
    assert.equal(h.count("static_rebuild_queue"), 0);
    assert.equal(h.stats.batches, 0);
    assert.equal(h.stats.reads, 2, "identity/ToS plus one joined settings/relation read");
  } finally {
    h.sqlite.close();
  }
});

test("SA-030 U04 staged: stale CAS rolls back relation, queue and audit together", async () => {
  const h = stagedSa030Harness({ mutateAfterRead: true });
  try {
    const response = await h.remove();
    assert.equal(response.status, 500);
    assert.equal((await response.json()).ok, false);
    assert.equal(h.sqlite.prepare("SELECT updated_at FROM event_group_events").get().updated_at, 201);
    assert.equal(h.count("audit_logs"), 0);
    assert.equal(h.count("static_rebuild_queue"), 0);
    assert.equal(h.stats.batches, 1);
  } finally {
    h.sqlite.close();
  }
});

test("SA-030 U04 staged: missing group/member and origin/role denials never mutate", async () => {
  const h = stagedSa030Harness();
  const m = stagedSa030Harness({ role: "moderator" });
  try {
    assert.equal((await h.remove("/api/admin/event-groups/missing/events/ev-1")).status, 404);
    assert.equal((await h.remove("/api/admin/event-groups/grp-1/events/absent")).status, 404);
    const origin = await h.remove(undefined, "https://attacker.example");
    assert.equal(origin.status, 403);
    assert.equal((await origin.json()).reason, "invalid_origin");
    assert.equal((await m.remove()).status, 403);
    assert.equal(h.count("audit_logs"), 0);
    assert.equal(h.count("static_rebuild_queue"), 0);
    assert.equal(h.count("event_group_events"), 1);
    assert.equal(m.count("event_group_events"), 1);
    assert.equal(h.stats.batches, 0);
    assert.equal(m.stats.batches, 0);
  } finally {
    h.sqlite.close();
    m.sqlite.close();
  }
});

test("SA-030 U04 staged: production admin index does not expose incomplete DELETE", async () => {
  const { db, sqlite, stats } = createAdminD1();
  try {
    seedBase(sqlite);
    const app = new Hono();
    app.route("/api/admin", createAdminRoutes({
      session: async (c, next) => {
        c.set("user", admin);
        c.set("sessionState", "user");
        await next();
      },
    }));
    const response = await app.request(
      new Request(STAGED_WRITE_SITE + "/api/admin/event-groups/grp-1/events/ev-1", {
        method: "DELETE",
        headers: { Origin: STAGED_WRITE_SITE },
      }),
      undefined, { DB: db, NEXT_PUBLIC_SITE_URL: STAGED_WRITE_SITE },
    );
    assert.equal(response.status, 404);
    assert.equal(stats.batches, 0);
  } finally {
    sqlite.close();
  }
});
