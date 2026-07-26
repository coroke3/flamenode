import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRandomPoolGenerationMaterial,
} from "./randomVideoPoolCore.ts";

function card(overrides = {}) {
  return {
    id: "video-1",
    title: "Title",
    youtube_video_id: "youtube-1",
    display_name: "Creator",
    icon_url: null,
    creator_x_user_id: "creator",
    primary_event_id: "event-1",
    scheduled_time: 100,
    ...overrides,
  };
}

test("カード表示内容が変わるとgeneration materialも変わる", () => {
  const base =
    buildRandomPoolGenerationMaterial([
      card(),
    ]);

  for (const changed of [
    card({ title: "Changed" }),
    card({ youtube_video_id: "youtube-2" }),
    card({ display_name: "Changed Creator" }),
    card({ icon_url: "https://example.com/icon.png" }),
    card({ creator_x_user_id: "other" }),
    card({ primary_event_id: "event-2" }),
    card({ scheduled_time: 200 }),
  ]) {
    assert.notEqual(
      buildRandomPoolGenerationMaterial([
        changed,
      ]),
      base,
    );
  }
});

test("入力順が違ってもgeneration materialは同一", () => {
  const first = card({ id: "a" });
  const second = card({ id: "b" });

  assert.equal(
    buildRandomPoolGenerationMaterial([
      first,
      second,
    ]),
    buildRandomPoolGenerationMaterial([
      second,
      first,
    ]),
  );
});
