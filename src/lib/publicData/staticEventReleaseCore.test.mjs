import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStaticEventRelease } from "./staticEventReleaseCore.ts";

test("event release payloadはpublic videoとpublic memberだけを正規化する", () => {
  const result = normalizeStaticEventRelease({
    schema_version: 1,
    generated_at: 10,
    event: { id: "event-1", title: "公開イベント", visibility_status: "public" },
    total: 1,
    truncated: false,
    videos: [
      {
        id: "video-1",
        title: "作品",
        visibility_status: "public",
        collaboration_type: "collab",
        members: [
          { name: "private-member", is_public_member: 0, order_index: 3 },
          { name: "公開", is_public_member: 1, order_index: 2 },
          { name: "", is_public_member: 1, order_index: 1 },
        ],
      },
      { id: "private", title: "非公開", visibility_status: "private", members: [] },
    ],
  });
  assert.equal(result?.videos.length, 1);
  assert.equal(result?.videos[0].members.length, 1);
  assert.equal(result?.videos[0].members[0].name, "公開");
});

test("event release payloadはschema/event visibility不一致を拒否する", () => {
  assert.equal(normalizeStaticEventRelease({ schema_version: 2, event: {}, videos: [] }), null);
  assert.equal(
    normalizeStaticEventRelease({
      schema_version: 1,
      event: { id: "event-1", title: "private", visibility_status: "private" },
      videos: [],
    }),
    null,
  );
});
test("event release は Date 範囲外の scheduled_time を null に落とす", () => {
  const result = normalizeStaticEventRelease({
    schema_version: 1,
    event: { id: "event-1", title: "public", visibility_status: "public" },
    videos: [
      {
        id: "video-1",
        title: "public",
        visibility_status: "public",
        scheduled_time: Number.MAX_SAFE_INTEGER,
        members: [],
      },
    ],
  });
  assert.equal(result?.videos[0].scheduled_time, null);
});

test("event release normalizer does not expose stale counts for filtered videos", () => {
  const result = normalizeStaticEventRelease({
    schema_version: 1,
    event: { id: "event-1", title: "public", visibility_status: "public" },
    total: 2,
    videos: [
      { id: "video-1", title: "public", visibility_status: "public", members: [] },
      { id: "video-2", title: "private", visibility_status: "private", members: [] },
    ],
  });
  assert.equal(result?.videos.length, 1);
  assert.equal(result?.total, 1);
});

test("event release excludes contradictory explicit video status before public projection", () => {
  const release = normalizeStaticEventRelease({
    schema_version: 1,
    generated_at: 1700000000,
    event: { id: "event-1", title: "Public Event", visibility_status: "public" },
    total: 10,
    truncated: false,
    videos: [
      { id: "public-only", title: "Public", visibility_status: "public", members: [] },
      { id: "public-alias", title: "Public", visibility_status: "public", status: "public", members: [] },
      { id: "null-alias", title: "Public", visibility_status: "public", status: null, members: [] },
      { id: "private-alias", title: "Hidden", visibility_status: "public", status: "private", members: [
        { name: "Hidden member", is_public_member: 1 },
      ] },
      { id: "draft-alias", title: "Hidden", visibility_status: "public", status: "draft", members: [] },
      { id: "malformed-alias", title: "Hidden", visibility_status: "public", status: false, members: [] },
      { id: "empty-alias", title: "Hidden", visibility_status: "public", status: "", members: [] },
      { id: "inverse-conflict", title: "Hidden", visibility_status: "private", status: "public", members: [] },
    ],
  });
  assert.ok(release);
  assert.deepEqual(release.videos.map((video) => video.id), [
    "public-only", "public-alias", "null-alias",
  ]);
  assert.ok(release.videos.every((video) => video.visibility_status === "public"));
  assert.equal(release.total, 3, "do not expose stale total after excluding revoked rows");
  assert.equal(release.truncated, false);
});

test("event release preserves valid legacy/public counts and producer truncation", () => {
  const release = normalizeStaticEventRelease({
    schema_version: 1,
    event: { id: "event-1", title: "Public Event", visibility_status: "public" },
    total: 9,
    truncated: true,
    videos: [
      { id: "legacy", title: "Public", visibility_status: "public", members: [] },
      { id: "explicit", title: "Public", visibility_status: "public", status: "public", members: [] },
    ],
  });
  assert.deepEqual(release?.videos.map((video) => video.id), ["legacy", "explicit"]);
  assert.equal(release?.total, 9);
  assert.equal(release?.truncated, true);
});
