import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchLiveSlots, parseLiveSlots } from "./liveSlots.ts";

test("RH-020 live slots accepts only the three CURRENT slot states", () => {
  const valid = parseLiveSlots({
    slots: [
      { id: "open", status: "available" },
      { id: "reserved", status: "reserved", display_name: "表示名" },
      { id: "submitted", status: "submitted", public_video_id: "video-1" },
    ],
    truncated: true,
  });
  assert.deepEqual(valid, {
    slots: [
      { id: "open", status: "available", display_name: null, public_video_id: null },
      { id: "reserved", status: "reserved", display_name: "表示名", public_video_id: null },
      { id: "submitted", status: "submitted", display_name: null, public_video_id: "video-1" },
    ],
    truncated: true,
  });
});

test("unknown live slot states reject the entire response instead of showing occupied slots", () => {
  for (const status of ["", "cancelled", "deleted", "unknown", "AVAILABLE", null, 1, {}, []]) {
    const parsed = parseLiveSlots({ slots: [{ id: "slot-1", status }] });
    assert.equal(parsed, null, String(status));
  }
  assert.equal(parseLiveSlots({ slots: [{ id: "slot-1", status: "available" }, { id: "slot-2", status: "archived" }] }), null);
});

test("fetchLiveSlots returns an unavailable result on unknown API status", async () => {
  const seen = [];
  const response = await fetchLiveSlots("event-1", undefined, async (url, init) => {
    seen.push({ url, credentials: init.credentials });
    return { ok: true, json: async () => ({ slots: [{ id: "slot-1", status: "archived" }] }) };
  });
  assert.equal(response, null);
  assert.deepEqual(seen, [{ url: "/api/live/events/event-1/slots", credentials: "omit" }]);
});

test("existing no-data and malformed rows still fail closed", () => {
  assert.equal(parseLiveSlots(null), null);
  assert.equal(parseLiveSlots({ slots: "invalid" }), null);
  assert.equal(parseLiveSlots({ slots: [{ id: 1, status: "available" }] }), null);
  assert.deepEqual(parseLiveSlots({ slots: [] }), { slots: [], truncated: false });
});
