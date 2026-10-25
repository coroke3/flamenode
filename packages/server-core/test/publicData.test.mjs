import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTrimmedString,
  normalizeNullableUnix,
  normalizeCount,
} from "../src/publicData/normalize.ts";

import {
  isPublicVideoListable,
  normalizePublicEventVisibility,
} from "../src/publicData/visibility.ts";

import {
  normalizeStaticEventsIndex,
} from "../src/publicData/eventsIndexCore.ts";

import {
  EVENT_RELEASE_SCHEMA_VERSION,
  eventReleaseObjectKey,
  normalizeStaticEventRelease,
} from "../src/publicData/eventReleaseCore.ts";

import {
  buildPublicArtifactVisibilityContext,
  filterPublicArtifactPayload,
} from "../src/publicData/artifactVisibility.ts";

import {
  PUBLIC_LISTABLE_X_APPROVAL_STATUSES,
} from "../src/publicData/publicXUser.ts";

import {
  PUBLIC_EVENT_KEYS,
  FORBIDDEN_PUBLIC_KEYS,
  assertNoForbiddenKeys,
} from "../src/publicData/publicDto.ts";

import {
  parseBoundedPositiveInt,
  checkPublicApiRateLimit,
  clearPublicApiRateLimitForTests,
} from "../src/publicData/publicApi.ts";

test("publicData normalize helpers handle null and edge cases", () => {
  assert.equal(normalizeTrimmedString("  hello "), "hello");
  assert.equal(normalizeTrimmedString("   "), null);
  assert.equal(normalizeTrimmedString(null), null);

  assert.equal(normalizeNullableUnix("1700000000"), 1700000000);
  assert.equal(normalizeNullableUnix(""), null);
  assert.equal(normalizeNullableUnix(null), null);

  assert.equal(normalizeCount("10"), 10);
  assert.equal(normalizeCount("-1"), null);
  assert.equal(normalizeCount(null), 0);
  assert.equal(normalizeCount(undefined), null);
});

test("publicData visibility helpers enforce public status strictly", () => {
  assert.equal(isPublicVideoListable("public"), true);
  assert.equal(isPublicVideoListable("private"), false);
  assert.equal(isPublicVideoListable(null), false);

  assert.equal(normalizePublicEventVisibility("public"), "public");
  assert.equal(normalizePublicEventVisibility("private"), null);
});

test("eventsIndexCore normalizes events and excludes point events", () => {
  const result = normalizeStaticEventsIndex({
    generated_at: 1700000000,
    items: [
      {
        id: "evt_normal",
        title: "Normal Event",
        start_time: 1700001000,
        end_time: 1700002000,
        visibility_status: "public",
      },
      {
        id: "evt_point",
        title: "Point Event",
        start_time: 1700001000,
        end_time: undefined, // point event
        visibility_status: "public",
      },
      {
        id: "evt_private",
        title: "Private Event",
        start_time: 1700001000,
        end_time: 1700002000,
        visibility_status: "private",
      },
    ],
  });

  assert.ok(result);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.id, "evt_normal");
});

test("eventReleaseCore keys and normalizer", () => {
  assert.equal(EVENT_RELEASE_SCHEMA_VERSION, 1);
  assert.equal(eventReleaseObjectKey("evt1"), "events/evt1/release.v1.json");

  const release = normalizeStaticEventRelease({
    schema_version: 1,
    generated_at: 1700000000,
    event: {
      id: "evt1",
      title: "Event One",
      visibility_status: "public",
    },
    videos: [
      {
        id: "vid1",
        title: "Video One",
        visibility_status: "public",
        collaboration_type: "individual",
        creator_display_name: "Creator",
        members: [],
      },
    ],
  });

  assert.ok(release);
  assert.equal(release.event.id, "evt1");
  assert.equal(release.videos.length, 1);
});

test("artifactVisibility filters blocked entities", () => {
  const context = buildPublicArtifactVisibilityContext({
    version: 1,
    generated_at: 1700000000,
    entities: [
      { entity_type: "video", entity_id: "vid_blocked", blocked_at: 1700000000 },
      { entity_type: "event", entity_id: "evt_blocked", blocked_at: 1700000000 },
    ],
  });

  assert.ok(context);
  assert.equal(context.blockedVideoIds.has("vid_blocked"), true);
  assert.equal(context.blockedEventIds.has("evt_blocked"), true);

  const payload = {
    items: [
      { id: "vid_ok", visibility_status: "public" },
      { id: "vid_blocked", visibility_status: "public" },
    ],
  };

  const filtered = filterPublicArtifactPayload("list_recent", payload, context);
  assert.ok(filtered);
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0]?.id, "vid_ok");
});

test("publicXUser listable statuses includes approved/pending/imported", () => {
  assert.deepEqual(PUBLIC_LISTABLE_X_APPROVAL_STATUSES, ["approved", "pending", "imported"]);
});

test("publicDto contracts and forbidden key guard", () => {
  assert.ok(PUBLIC_EVENT_KEYS.includes("id"));
  assert.ok(PUBLIC_EVENT_KEYS.includes("title"));
  assert.ok(FORBIDDEN_PUBLIC_KEYS.has("email"));

  assert.doesNotThrow(() => {
    assertNoForbiddenKeys({ id: "vid1", title: "Public Video" });
  });

  assert.throws(
    () => {
      assertNoForbiddenKeys({ id: "vid1", email: "secret@example.com" });
    },
    { message: /Public API leak: forbidden key "email"/ }
  );
});

test("publicApi parseBoundedPositiveInt and rate limit", () => {
  assert.equal(parseBoundedPositiveInt("10", 60, 60), 10);
  assert.equal(parseBoundedPositiveInt("0", 60, 60), 60);
  assert.equal(parseBoundedPositiveInt("-5", 60, 60), 1);
  assert.equal(parseBoundedPositiveInt("100", 60, 60), 60);
  assert.equal(parseBoundedPositiveInt(null, 60, 60), 60);

  clearPublicApiRateLimitForTests();
  const req = new Request("http://localhost/api/events", {
    headers: { "CF-Connecting-IP": "127.0.0.1" },
  });

  for (let i = 0; i < 60; i++) {
    const res = checkPublicApiRateLimit(req, "/api/events", 1000);
    assert.equal(res, null);
  }

  const blocked = checkPublicApiRateLimit(req, "/api/events", 1000);
  assert.ok(blocked);
  assert.equal(blocked.status, 429);
  clearPublicApiRateLimitForTests();
});
