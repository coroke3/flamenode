import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizePublicProfileXId } from "../src/publicData/publicProfileXId.ts";
import { normalizeStaticVideoDetail } from "../src/publicData/videoDetailCore.ts";
import { normalizeStaticEventDetail } from "../src/publicData/eventDetailCore.ts";

test("public X ID projection permits canonical handles and normalizes legacy case / @ prefixes", () => {
  assert.equal(normalizePublicProfileXId("member_a"), "member_a");
  assert.equal(normalizePublicProfileXId("  @Member_A  "), "member_a");
  assert.equal(normalizePublicProfileXId("_a"), "_a");
  assert.equal(normalizePublicProfileXId("a".repeat(20)), "a".repeat(20));
});

test("public X ID projection rejects non-segments, invalid types, unicode and overlong identifiers", () => {
  for (const input of [
    "../admin", "..", "member/another", "member\\another",
    "user?next=/admin", "user#x", "user%2fadmin", "%2e%2e",
    "https://x.com/member", "user\u0000evil", "日本語", "a".repeat(21),
    "", "@", null, undefined, 42, { toString() { throw new Error("must not coerce"); } },
  ]) {
    assert.equal(normalizePublicProfileXId(input), null, JSON.stringify(input));
  }
  assert.equal(new URL("/user/../admin", "https://flamenode.net").pathname, "/admin",
    "without canonical validation, a snapshot ID can escape the public profile path");
});

test("video detail projection cannot promote malformed creator, member or related-video X IDs", () => {
  const detail = normalizeStaticVideoDetail({
    video: {
      id: "video-1", title: "Public Video", visibility_status: "public",
      creator_x_user_id: "../admin", creator_has_public_profile: true,
    },
    public_members: [
      { id: "m1", display_name: "Wrong", x_user_id: "member?next=/ops", has_public_profile: true },
      { id: "m2", display_name: "Valid", x_user_id: "@Member_A", has_public_profile: true },
    ],
    related_videos: [
      { id: "r1", title: "Related", display_name: "Another", creator_x_user_id: "foo/bar" },
    ],
  });
  assert.ok(detail);
  assert.equal(detail.video.creator_x_user_id, undefined);
  assert.equal(detail.video.title, "Public Video");
  assert.deepEqual(detail.publicMembers.map((m) => m.x_user_id), [null, "member_a"]);
  assert.equal(detail.publicMembers[0].has_public_profile, true,
    "existing visibility flag is not authority to bypass the ID fence");
  assert.equal(detail.relatedVideos[0].creator_x_user_id, null);
  assert.equal(normalizeStaticVideoDetail({
    video: { id: "v2", title: "Private", visibility_status: "private" },
  }), null);
});

test("public event staff and video creator X IDs share the same profile-link fence", () => {
  const detail = normalizeStaticEventDetail({
    event: { id: "event-1", title: "Public Event", visibility_status: "public" },
    public_staff: [
      { display_name: "Wrong", x_user_id: "../admin", has_public_profile: true },
      { display_name: "Valid", x_user_id: "@Staff_1", has_public_profile: true },
    ],
    public_videos: [
      { id: "v1", title: "Public Video", visibility_status: "public", creator_x_user_id: "someone#fragment" },
      { id: "v2", title: "Valid Video", visibility_status: "public", creator_x_user_id: "Creator_1" },
    ],
  });
  assert.ok(detail);
  assert.deepEqual(detail.publicStaff.map((m) => m.x_user_id), [null, "staff_1"]);
  assert.deepEqual(detail.publicVideos.map((v) => v.creator_x_user_id), [null, "creator_1"]);
  assert.equal(detail.event.title, "Public Event");
  assert.equal(normalizeStaticEventDetail({
    event: { id: "e2", title: "Private", visibility_status: "private" },
  }), null);
});
