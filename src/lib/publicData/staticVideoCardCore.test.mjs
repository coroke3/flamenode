import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePublicVideoCard,
  normalizePublicVideoCardList,
  normalizeStaticVideoCardBase,
} from "./staticVideoCardCore.ts";

test("normalizeStaticVideoCardBase は id・title が無い行と object 以外を捨てる", () => {
  assert.equal(normalizeStaticVideoCardBase(null), null);
  assert.equal(normalizeStaticVideoCardBase("v1"), null);
  assert.equal(normalizeStaticVideoCardBase({ id: "v1", title: " " }), null);
  assert.equal(normalizeStaticVideoCardBase({ id: "", title: "T" }), null);
});

test("normalizeStaticVideoCardBase は動画行の表示名とアイコンを creator_* より優先する", () => {
  assert.deepEqual(
    normalizeStaticVideoCardBase({
      id: "v1",
      title: "T",
      display_name: "",
      creator_display_name: "Creator",
      icon_url: "https://example.com/a.png",
      creator_icon_url: "https://example.com/b.png",
      scheduled_time: "1700000000.9",
    }),
    {
      id: "v1",
      title: "T",
      youtube_video_id: null,
      display_name: "Creator",
      icon_url: "https://example.com/a.png",
      primary_event_id: null,
      scheduled_time: 1_700_000_000,
    },
  );
  assert.equal(
    normalizeStaticVideoCardBase({ id: "v1", title: "T" }).display_name,
    "unknown",
  );
});

test("normalizePublicVideoCard は status（無ければ visibility_status）が public の行だけを返す", () => {
  const row = { id: "v1", title: "T", part: "A", creator_x_user_id: "alice" };
  assert.equal(normalizePublicVideoCard(row), null);
  assert.equal(normalizePublicVideoCard({ ...row, status: "private", visibility_status: "public" }), null);
  assert.deepEqual(normalizePublicVideoCard({ ...row, visibility_status: "public" }), {
    id: "v1",
    title: "T",
    youtube_video_id: null,
    display_name: "unknown",
    icon_url: null,
    primary_event_id: null,
    scheduled_time: null,
    creator_x_user_id: "alice",
    status: "public",
    part: "A",
  });
  assert.deepEqual(
    normalizePublicVideoCardList([{ ...row, status: "public" }, { ...row, status: "unlisted" }, null]).map((video) => video.id),
    ["v1"],
  );
  assert.deepEqual(normalizePublicVideoCardList("not-a-list"), []);
});
