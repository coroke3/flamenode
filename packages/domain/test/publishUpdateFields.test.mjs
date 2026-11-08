import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildPublishEventUpdateFields } from "@flamenode/domain/event";

const build = (data, visibilityStatus = "private") =>
  buildPublishEventUpdateFields({ data, visibilityStatus });

test("MIG-0652 U01: publish projection preserves CURRENT fields and JST timestamps", () => {
  assert.deepEqual(build({
    entry_start_time: "2026-11-08T10:30",
    entry_end_time: "2026-11-09T12:00:45",
    allow_user_video_event_links: 1, allow_unslotted_posts: 0,
  }, "public"), {
    visibility_status: "public",
    entry_start_time: Date.parse("2026-11-08T01:30:00Z") / 1000,
    entry_end_time: Date.parse("2026-11-09T03:00:45Z") / 1000,
    allow_user_video_event_links: 1,
    allow_unslotted_posts: 0,
  });
});

test("MIG-0652 U01: absent and malformed entry windows map to null as CURRENT", () => {
  assert.deepEqual(build({
    allow_user_video_event_links: 0, allow_unslotted_posts: 1,
  }), {
    visibility_status: "private",
    entry_start_time: null, entry_end_time: null,
    allow_user_video_event_links: 0, allow_unslotted_posts: 1,
  });
  const invalid = build({
    entry_start_time: "2026-02-30T01:00", entry_end_time: "no date",
    allow_user_video_event_links: 1, allow_unslotted_posts: 1,
  });
  assert.equal(invalid.entry_start_time, null);
  assert.equal(invalid.entry_end_time, null);
});

test("MIG-0652 U01: original 0 and 1 flags are retained, not coerced to booleans", () => {
  for (const allowed of [0, 1]) {
    const row = build({
      entry_start_time: "", entry_end_time: null,
      allow_user_video_event_links: allowed,
      allow_unslotted_posts: 1 - allowed,
    });
    assert.equal(row.allow_user_video_event_links, allowed);
    assert.equal(row.allow_unslotted_posts, 1 - allowed);
    assert.equal(typeof row.allow_user_video_event_links, "number");
  }
});

test("MIG-0652 U01: midnight UTC boundary is correctly evaluated in Asia/Tokyo", () => {
  const result = build({
    entry_start_time: "2026-01-01T00:00",
    entry_end_time: "2026-01-01T00:00:01",
    allow_user_video_event_links: 0, allow_unslotted_posts: 0,
  });
  assert.equal(result.entry_start_time, Date.parse("2025-12-31T15:00:00Z") / 1000);
  assert.equal(result.entry_end_time, result.entry_start_time + 1);
});

test("MIG-0652 U01: CURRENT adapter delegates publish fields only after visibility normalization and permission gate", async () => {
  const current = await readFile(new URL("../../../src/lib/event/eventPayload.ts", import.meta.url), "utf8");
  const core = await readFile(new URL("../src/event/publishUpdateFields.ts", import.meta.url), "utf8");
  assert.match(current, /if \(permissions\.publish\) \{\s*const visibilityStatus = resolveSubmittedEventVisibility\(data\)/);
  assert.match(current, /Object\.assign\(updatePayload, buildPublishEventUpdateFields\(\{/);
  assert.match(current, /changedByPermission\.publish = EVENT_SECTION_PERMISSION_KEYS\.publish/);
  assert.match(current, /if \(permissions\.basic\)/);
  assert.match(current, /if \(permissions\.questions\)/);
  assert.match(current, /if \(permissions\.slots\)/);
  assert.doesNotMatch(core, /from ["']@\//);
  assert.doesNotMatch(core, /drizzle|D1Database|\bsqlite\b/);
});
