import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStaticEventPlaylist } from "../src/publicData/eventPlaylistCore.ts";

const item = { id: "video-1", title: "Video", youtube_video_id: null, display_name: "Creator", scheduled_time: 1700000000 };
const valid = { schema_version: 1, generated_at: 1700000000, event_id: "event-1", complete: true, items: [item] };

test("event playlist preserves producer values and numeric timestamp strings", () => {
  for (const generated_at of [1700000000, "1700000000"]) {
    const result = normalizeStaticEventPlaylist({ ...valid, generated_at }, "event-1");
    assert.equal(result?.generatedAt, 1700000000);
    assert.equal(result?.items[0]?.scheduled_time, 1700000000);
    assert.equal(result?.complete, true);
  }
});

test("event playlist rejects coerced schema and malformed envelope", () => {
  for (const value of [null, [], { ...valid, schema_version: true }, { ...valid, schema_version: "1" }, { ...valid, schema_version: [1] }]) {
    assert.equal(normalizeStaticEventPlaylist(value), null);
  }
});

test("event playlist treats invalid generated timestamps as absent", () => {
  for (const generated_at of [true, false, [], [123], {}, " ", "", Infinity, "Infinity", "1e309"]) {
    assert.equal(normalizeStaticEventPlaylist({ ...valid, generated_at })?.generatedAt, null);
  }
  for (const generated_at of [null, undefined]) {
    assert.equal(normalizeStaticEventPlaylist({ ...valid, generated_at })?.generatedAt, null);
  }
});

test("event playlist treats invalid scheduled timestamps as absent", () => {
  for (const scheduled_time of [true, false, [], [123], {}, " ", "", Infinity, "Infinity", "1e309", null]) {
    assert.equal(normalizeStaticEventPlaylist({ ...valid, items: [{ ...item, scheduled_time }] })?.items[0]?.scheduled_time, null);
  }
  assert.equal(normalizeStaticEventPlaylist({ ...valid, items: [{ ...item, scheduled_time: "1700000000" }] })?.items[0]?.scheduled_time, 1700000000);
});

test("event playlist retains duplicate rejection and event ID matching", () => {
  assert.equal(normalizeStaticEventPlaylist(valid, "different"), null);
  assert.equal(normalizeStaticEventPlaylist({ ...valid, items: [item, item] }), null);
  assert.equal(normalizeStaticEventPlaylist({ ...valid, complete: false })?.complete, false);
});
