// MIG-0711 U01: entry reads have a contract-validated, fail-closed browser boundary.
import assert from "node:assert/strict";
import test from "node:test";
import { createPersonalApi, onboardingState, user } from "./helpers.mjs";

const valid = () => ({
  user: user(),
  state: onboardingState(),
  events: [{ id: "event_1", title: "イベント", entry_end_time: null, slots_available: 2 }],
  reservedSlots: [{
    id: "slot_1", event_id: "event_1", video_id: null, slot_label: "自由枠",
    start_time: null, status: "reserved", event_title: "イベント", event_entry_end_time: null,
  }],
  truncated: false, nextOffset: null,
});

function respond(status, data) {
  return { status, json: async () => data };
}

test("U01: the entry index is a same-origin, no-store GET with a validated DTO", async () => {
  const calls = [];
  const payload = valid();
  const api = createPersonalApi(async (target, init) => {
    calls.push({ target, init });
    return respond(200, payload);
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await api.getEntryIndex(signal), { status: "ok", data: payload });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, "/api/personal/entry");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal(calls[0].init.signal, signal);
  assert.equal(calls[0].init.body, undefined);
});

test("U01: anonymous remains anonymous for /entry, but denied and unavailable do not become success", async () => {
  for (const [response, expected] of [
    [respond(401, {}), "anonymous"],
    [respond(403, {}), "banned"],
    [respond(500, {}), "unavailable"],
    [respond(503, {}), "unavailable"],
  ]) {
    const result = await createPersonalApi(async () => response).getEntryIndex();
    assert.deepEqual(result, { status: expected });
  }
  assert.deepEqual(
    await createPersonalApi(async () => { throw new TypeError("offline"); }).getEntryIndex(),
    { status: "unavailable" },
  );
  assert.deepEqual(
    await createPersonalApi(async () => ({ status: 200, json: async () => { throw Error("bad json"); } })).getEntryIndex(),
    { status: "unavailable" },
  );
});

test("U01: partial or malformed public entry payloads cannot be rendered as valid state", async () => {
  const good = valid();
  for (const payload of [
    null, {}, { ...good, user: null }, { ...good, events: null },
    { ...good, reservedSlots: [{ ...good.reservedSlots[0], status: "available" }] },
    { ...good, events: [{ ...good.events[0], slots_available: "2" }] },
    { ...good, nextOffset: "100" },
  ]) {
    const result = await createPersonalApi(async () => respond(200, payload)).getEntryIndex();
    assert.deepEqual(result, { status: "unavailable" });
  }
});

test("U01 continuation: offset=100 is encoded exactly once and still validates the DTO", async () => {
  const targets = [];
  const api = createPersonalApi(async (target, init) => {
    targets.push([target, init]);
    return respond(200, { ...valid(), events: [], truncated: false, nextOffset: null });
  });
  const result = await api.getEntryIndex(undefined, 100);
  assert.equal(result.status, "ok");
  assert.deepEqual(targets.map(([target]) => target), ["/api/personal/entry?offset=100"]);
  assert.equal(targets[0][1].method, "GET");
  assert.equal(targets[0][1].body, undefined);
});

// MIG-0716 U01a: these clients only obtain the initial response; paging/authority stays with the later host.
const initialFormData = () => ({
  user: user({ active_x_user_id: "active_x" }), activeXId: "active_x", submitBlock: null,
  initialProfile: { display_name: "投稿者", icon_url: null, profile_text: "", youtube_channel_url: null, other_social_links: null },
  xIdOptions: [{ id: "active_x", x_name: "投稿者" }], softwareSuggestions: [], iconCandidates: [], channelCandidates: [],
  eventOptions: [], truncated: false, nextOffset: null,
});
const slottedRead = () => ({
  ...initialFormData(), kind: "ready", activeXName: "投稿者", slotPart: "A",
  slot: { id: "slot_1", slot_label: "通常枠", display_name: null, has_reservation_group: false,
    reserved_at_x_id: "active_x", start_time: null, end_time: null, group_size: 1 },
  event: { id: "event_1", title: "イベント" },
});
const unslottedRead = () => ({ ...initialFormData(), eventQuery: "合成 %_" });

test("MIG-0716 U01a: both initial GETs encode only the named query and preserve transport ownership", async () => {
  for (const [method, path, name, fixture] of [
    ["getSlottedEntry", "slotted", "slot", slottedRead],
    ["getUnslottedEntry", "unslotted", "event_q", unslottedRead],
  ]) {
    for (const value of ["", "  枠/100% + ?&offset=900  "]) {
      const calls = [], payload = fixture(), signal = new AbortController().signal;
      const api = createPersonalApi(async (target, init) => { calls.push({ target, init }); return respond(200, payload); });
      assert.deepEqual(await api[method](value, signal), { status: "ok", data: payload });
      assert.equal(calls.length, 1, "no session/preload/continuation read");
      const { target, init } = calls[0], parsed = new URL(target, "https://flamenode.test");
      assert.equal(parsed.pathname, `/api/personal/entry/${path}`);
      assert.deepEqual([...parsed.searchParams.keys()], value ? [name] : []);
      assert.equal(parsed.searchParams.get(name), value || null);
      assert.equal(parsed.searchParams.has("offset"), false);
      if (value) assert.match(target, /%2F100%25\+%2B\+%3F%26offset%3D900/);
      else assert.equal(target, `/api/personal/entry/${path}`);
      assert.deepEqual(init, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal });
    }
  }
});

test("MIG-0716 U01a: canonical redirect and paging metadata survive schema validation without client completion", async () => {
  const redirect = { kind: "redirect", to: "/dashboard/edit/video_1" };
  assert.deepEqual(await createPersonalApi(async () => respond(200, redirect)).getSlottedEntry("slot_1"), { status: "ok", data: redirect });
  for (const [method, fixture] of [["getSlottedEntry", slottedRead], ["getUnslottedEntry", unslottedRead]]) {
    for (const [truncated, nextOffset] of [[true, 100], [true, null], [false, 100], [false, null]]) {
      const payload = { ...fixture(), truncated, nextOffset };
      assert.deepEqual(await createPersonalApi(async () => respond(200, payload))[method]("query"), { status: "ok", data: payload });
    }
  }
  const payload = { ...unslottedRead(), eventQuery: "A".repeat(99) + "\ud83d" };
  assert.deepEqual(await createPersonalApi(async () => respond(200, payload)).getUnslottedEntry("raw query"), { status: "ok", data: payload },
    "server query drift remains visible; this client must not silently normalize it");
});

test("MIG-0716 U01a: only canonical slotted404 is not_found; unrelated reads and failures remain fail-closed", async () => {
  for (const [method, fixture] of [["getSlottedEntry", slottedRead], ["getUnslottedEntry", unslottedRead]]) {
    for (const [status, body, expected] of [
      [401, {}, "anonymous"], [403, {}, "banned"], [201, fixture(), "unavailable"], [204, null, "unavailable"],
      [500, {}, "unavailable"], [503, {}, "unavailable"],
      [404, { error: "not_found" }, method === "getSlottedEntry" ? "not_found" : "unavailable"],
      [404, { error: "other" }, "unavailable"], [404, null, "unavailable"], [404, [], "unavailable"],
      [404, { error: 404 }, "unavailable"],
    ]) {
      let calls = 0;
      const api = createPersonalApi(async () => { calls++; return respond(status, body); });
      assert.deepEqual(await api[method]("id"), { status: expected }, `${method} HTTP${status}`);
      assert.equal(calls, 1);
    }
    for (const status of [200, 404]) {
      const api = createPersonalApi(async () => ({ status, json: async () => { throw new SyntaxError("not JSON"); } }));
      assert.deepEqual(await api[method]("id"), { status: "unavailable" });
    }
    assert.deepEqual(await createPersonalApi(async () => { throw new TypeError("offline"); })[method]("id"), { status: "unavailable" });
    for (const payload of [null, {}, { ...fixture(), user: null }, { ...fixture(), initialProfile: {} },
      { ...fixture(), eventOptions: [{ id: "incomplete" }] }, { ...fixture(), nextOffset: "100" },
      { ...fixture(), submitBlock: "invented_block" }]) {
      assert.deepEqual(await createPersonalApi(async () => respond(200, payload))[method]("id"), { status: "unavailable" });
    }
  }
  const api = createPersonalApi(async () => respond(404, { error: "not_found" }));
  assert.deepEqual(await api.getDashboard(), { status: "unavailable" }, "generic read must not acquire the new slotted exception");
  assert.deepEqual(await api.getEntryIndex(), { status: "unavailable" });
});
