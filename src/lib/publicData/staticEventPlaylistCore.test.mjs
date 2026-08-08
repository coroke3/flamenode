import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_PLAYLIST_SCHEMA_VERSION,
  eventPlaylistObjectKey,
  normalizeStaticEventPlaylist,
} from "./staticEventPlaylistCore.ts";

test("event playlist object key is scoped by event", () => {
  assert.equal(
    eventPlaylistObjectKey("event-a"),
    "events/event-a/playlist.v1.json",
  );
});

test("normalizeStaticEventPlaylist validates schema and event id", () => {
  const normalized = normalizeStaticEventPlaylist(
    {
      schema_version: EVENT_PLAYLIST_SCHEMA_VERSION,
      generated_at: 1_700_000_000,
      event_id: "event-a",
      complete: true,
      items: [
        {
          id: "video-a",
          title: "Video A",
          youtube_video_id: "abcdefghijk",
          display_name: "Creator",
          scheduled_time: 123,
        },
      ],
    },
    "event-a",
  );

  assert.ok(normalized);
  assert.equal(normalized.complete, true);
  assert.equal(normalized.items[0].id, "video-a");
  assert.equal(
    normalizeStaticEventPlaylist(
      {
        schema_version: EVENT_PLAYLIST_SCHEMA_VERSION,
        event_id: "event-a",
        complete: true,
        items: [],
      },
      "event-b",
    ),
    null,
  );
});

test("malformed playlist rows fail closed to D1 fallback", () => {
  assert.equal(
    normalizeStaticEventPlaylist({
      schema_version: EVENT_PLAYLIST_SCHEMA_VERSION,
      event_id: "event-a",
      complete: true,
      items: [{ id: "video-a", title: "", display_name: "Creator" }],
    }),
    null,
  );
});
