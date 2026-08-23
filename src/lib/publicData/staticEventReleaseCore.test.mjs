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
