import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_PLAYLIST_SCHEMA_VERSION,
  normalizeStaticEventPlaylist,
} from "../src/publicData/eventPlaylistCore.ts";

function payload(overrides = {}) {
  return {
    schema_version: EVENT_PLAYLIST_SCHEMA_VERSION,
    generated_at: 1_729_000_000,
    event_id: "event-a",
    complete: true,
    items: [
      {
        id: "video-a",
        title: "Video A",
        youtube_video_id: "abcdefghijk",
        display_name: "Creator",
        scheduled_time: 1_728_000_000,
      },
    ],
    ...overrides,
  };
}

test("event playlist requires the producer's literal numeric schema version", () => {
  for (const schemaVersion of ["1", true, false, [], [1], {}, " "]) {
    assert.equal(
      normalizeStaticEventPlaylist(payload({ schema_version: schemaVersion })),
      null,
      JSON.stringify(schemaVersion),
    );
  }
});

test("event playlist generated_at rejects booleans, arrays, objects and blank strings", () => {
  for (const generatedAt of [true, false, [], [1_729_000_000], {}, " "]) {
    assert.equal(
      normalizeStaticEventPlaylist(payload({ generated_at: generatedAt })),
      null,
      JSON.stringify(generatedAt),
    );
  }
});

test("event playlist item scheduled_time rejects coercible non-primitive values", () => {
  for (const scheduledTime of [true, false, [], [1_728_000_000], {}, " "]) {
    assert.equal(
      normalizeStaticEventPlaylist(payload({
        items: [{ ...payload().items[0], scheduled_time: scheduledTime }],
      })),
      null,
      JSON.stringify(scheduledTime),
    );
  }
});

test("event playlist keeps nullable timestamps and valid numeric-string compatibility", () => {
  const nullable = normalizeStaticEventPlaylist(payload({
    generated_at: null,
    items: [{ ...payload().items[0], scheduled_time: null }],
  }));
  assert.ok(nullable);
  assert.equal(nullable.generatedAt, null);
  assert.equal(nullable.items[0].scheduled_time, null);

  const numericStrings = normalizeStaticEventPlaylist(payload({
    generated_at: "1729000000",
    items: [{ ...payload().items[0], scheduled_time: "1728000000" }],
  }));
  assert.ok(numericStrings);
  assert.equal(numericStrings.generatedAt, 1_729_000_000);
  assert.equal(numericStrings.items[0].scheduled_time, 1_728_000_000);
});

test("event playlist retains duplicate, item-limit and event-id guards", () => {
  assert.equal(normalizeStaticEventPlaylist(payload(), "event-b"), null);
  assert.equal(normalizeStaticEventPlaylist(payload({
    items: [
      payload().items[0],
      { ...payload().items[0], title: "Duplicate id" },
    ],
  })), null);
  assert.equal(normalizeStaticEventPlaylist(payload({
    items: Array.from({ length: 501 }, (_, index) => ({
      id: `video-${index}`,
      title: "Video",
      display_name: "Creator",
    })),
  })), null);
});
