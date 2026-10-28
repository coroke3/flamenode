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
