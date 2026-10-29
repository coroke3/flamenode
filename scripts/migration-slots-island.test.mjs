// MIG-0514 U02: HTTP request contract, not an integration substitute for MIG-0657 / browser parity.
import assert from "node:assert/strict";
import test from "node:test";
import {
  reserveSlot, releaseSlot, extendSlot, mergeSlotGroup,
} from "../apps/site/src/lib/slotReservation.ts";

function server(status, body) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetcher, calls };
}

function assertPost(call, expectedUrl, body) {
  assert.equal(call.url, expectedUrl);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.credentials, "same-origin");
  assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.headers.Accept, "application/json");
  if (body === undefined) {
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.headers["Content-Type"], undefined);
  } else {
    assert.equal(call.init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(call.init.body), body);
  }
}

test("U02 reserve sends the CURRENT form keys without slot_id in the JSON body", async () => {
  const srv = server(200, { ok: true, slotId: "s1", slotCount: 2, groupSize: 2, pendingPublicReflection: true });
  const result = await reserveSlot("autumn", "s1", { display_name: "制作者", consecutive_count: 2 }, srv.fetcher);
  assert.equal(result.pendingPublicReflection, true);
  assertPost(srv.calls[0], "/api/events/autumn/slots/s1/reserve", {
    display_name: "制作者", consecutive_count: 2,
  });
  assert.equal(srv.calls.length, 1);
});

test("U02 operator override is present only when explicitly supplied", async () => {
  const srv = server(200, { ok: true });
  await reserveSlot("my/event", "slot?#", {
    display_name: "運営", consecutive_count: 1, operator_override: false,
  }, srv.fetcher);
  assertPost(srv.calls[0], "/api/events/my%2Fevent/slots/slot%3F%23/reserve", {
    display_name: "運営", consecutive_count: 1, operator_override: false,
  });
  await reserveSlot("my/event", "slot?#", {
    display_name: "運営", consecutive_count: 1, operator_override: true,
  }, srv.fetcher);
  assert.equal(JSON.parse(srv.calls[1].init.body).operator_override, true);
});

test("U02 release POST has no JSON body", async () => {
  const srv = server(200, { ok: true });
  assert.deepEqual(await releaseSlot("e", "s", srv.fetcher), { ok: true });
  assertPost(srv.calls[0], "/api/events/e/slots/s/release", undefined);
});

test("U02 extend direction uses the slot id in the URL, not a group id", async () => {
  const srv = server(200, { ok: true });
  await extendSlot("e", "s", { direction: "forward" }, srv.fetcher);
  await extendSlot("e", "s", { direction: "backward" }, srv.fetcher);
  assertPost(srv.calls[0], "/api/events/e/slots/s/extend", { direction: "forward" });
  assertPost(srv.calls[1], "/api/events/e/slots/s/extend", { direction: "backward" });
});

test("U02 merge sends gap_slot_id and display_name only", async () => {
  const srv = server(200, { ok: true });
  await mergeSlotGroup("e", { gap_slot_id: "gap-slot", display_name: "制作者" }, srv.fetcher);
  assertPost(srv.calls[0], "/api/events/e/slot-groups/merge", {
    gap_slot_id: "gap-slot", display_name: "制作者",
  });
});

test("U02 409 race loser and 403 guard denial preserve error payload for CURRENT UI", async () => {
  const raced = server(409, { ok: false, message: "先に確保されました" });
  assert.deepEqual(await reserveSlot("e", "s", {
    display_name: "a", consecutive_count: 1,
  }, raced.fetcher), { ok: false, message: "先に確保されました" });
  const guarded = server(403, { ok: false, reason: "tos_required", message: "同意が必要です" });
  assert.deepEqual(await releaseSlot("e", "s", guarded.fetcher), {
    ok: false, reason: "tos_required", message: "同意が必要です",
  });
});

test("U02 malformed JSON, missing boolean ok and inconsistent HTTP status fail closed", async () => {
  const input = { display_name: "a", consecutive_count: 1 };
  for (const invalid of [null, [], {}, { ok: "true" }, { ok: 1 }]) {
    await assert.rejects(reserveSlot("e", "s", input, server(200, invalid).fetcher), TypeError);
  }
  await assert.rejects(releaseSlot("e", "s", server(503, { ok: true }).fetcher), TypeError);
  const throwingFetcher = async () => { throw new SyntaxError("not JSON"); };
  await assert.rejects(extendSlot("e", "s", { direction: "forward" }, throwingFetcher), SyntaxError);
});
