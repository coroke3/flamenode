import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizePublicVideoCard,
  normalizePublicVideoCardList,
} from "../src/publicData/videoCardCore.ts";

const card = (id, visibility) => ({
  id,
  title: `Video ${id}`,
  display_name: "Creator",
  youtube_video_id: "yt123",
  ...visibility,
});

test("public card accepts either legacy or new public visibility field", () => {
  for (const fields of [
    { status: "public" },
    { visibility_status: "public" },
    { status: "public", visibility_status: "public" },
    { status: null, visibility_status: "public" },
    { status: "public", visibility_status: null },
  ]) {
    const result = normalizePublicVideoCard(card("visible", fields));
    assert.ok(result, JSON.stringify(fields));
    assert.equal(result.status, "public");
    assert.equal(result.title, "Video visible");
    assert.equal(result.youtube_video_id, "yt123");
  }
});

test("public card rejects an explicit private or draft field even if its alias says public", () => {
  for (const fields of [
    { status: "public", visibility_status: "private" },
    { status: "private", visibility_status: "public" },
    { status: "public", visibility_status: "draft" },
    { status: "scheduled", visibility_status: "public" },
    { status: "public", visibility_status: 0 },
    { status: false, visibility_status: "public" },
    { status: "private" },
    { visibility_status: "draft" },
  ]) {
    assert.equal(normalizePublicVideoCard(card("revoked", fields)), null, JSON.stringify(fields));
  }
});

test("public card does not infer publication when both fields are absent or null", () => {
  for (const fields of [{}, { status: null }, { visibility_status: null }, { status: null, visibility_status: null }]) {
    assert.equal(normalizePublicVideoCard(card("unmarked", fields)), null);
  }
});

test("public card list preserves public order and discards conflicting visibility rows", () => {
  const result = normalizePublicVideoCardList([
    card("first", { visibility_status: "public" }),
    card("revoked", { status: "public", visibility_status: "private" }),
    card("second", { status: "public" }),
    card("private", { status: "private", visibility_status: "public" }),
    card("last", { status: "public", visibility_status: "public" }),
    card("missing-title", { status: "public", title: "" }),
  ]);
  assert.deepEqual(result.map((item) => item.id), ["first", "second", "last"]);
  assert.equal(result[0].title, "Video first");
  assert.ok(result.every((item) => item.status === "public"));
});
