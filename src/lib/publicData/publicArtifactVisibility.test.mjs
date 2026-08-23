import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicArtifactVisibilityContext,
  filterPublicArtifactPayload,
} from "./publicArtifactVisibility.ts";

test("global artifact filter removes private video/event rows without mutating payload", () => {
  const payload = {
    items: [
      { id: "public", title: "Public", status: "public" },
      { id: "private", title: "Private", status: "private" },
      { id: "legacy", title: "Legacy" },
    ],
    active_events: [
      { id: "event-public", title: "Public", visibility_status: "public" },
      { id: "event-private", title: "Private", visibility_status: "private" },
    ],
  };

  const filtered = filterPublicArtifactPayload("top", payload);
  assert.ok(filtered);
  assert.deepEqual(filtered.items, [payload.items[0], payload.items[2]]);
  assert.deepEqual(filtered.active_events, [payload.active_events[0]]);
  assert.equal(payload.items.length, 3);
  assert.equal(payload.active_events.length, 2);
});

test("nested event/user artifacts fail closed for top-level private entities", () => {
  assert.equal(
    filterPublicArtifactPayload("event", {
      event: { id: "e1", title: "Hidden", visibility_status: "private" },
    }),
    null,
  );
  assert.equal(
    filterPublicArtifactPayload("user", {
      user: { id: "u1", x_name: "Hidden", approval_status: "rejected" },
    }),
    null,
  );
});

test("user rows keep every canonical public-listable approval status", () => {
  for (const approval_status of ["approved", "pending", "imported"]) {
    const filtered = filterPublicArtifactPayload("users_index", {
      items: [{ x_id: `user-${approval_status}`, approval_status }],
    });
    assert.equal(filtered?.items.length, 1, approval_status);
  }
});

test("video detail filter removes private related rows and events", () => {
  const payload = {
    video: { id: "v1", title: "Video", visibility_status: "public" },
    related_videos: [
      { id: "r1", title: "Public", status: "public" },
      { id: "r2", title: "Private", status: "private" },
    ],
    public_events: [
      { id: "e1", title: "Public", visibility_status: "public" },
      { id: "e2", title: "Private", visibility_status: "private" },
    ],
  };
  const filtered = filterPublicArtifactPayload("video", payload);
  assert.ok(filtered);
  assert.equal(filtered.related_videos.length, 1);
  assert.equal(filtered.public_events.length, 1);
  assert.equal(payload.related_videos.length, 2);
});

test("event release filter removes fenced videos and adjusts the public count", () => {
  const filtered = filterPublicArtifactPayload(
    "event_release",
    {
      event: { id: "e1", visibility_status: "public" },
      videos: [
        { id: "v-hidden", title: "old", visibility_status: "public" },
        { id: "v-ok", title: "ok", visibility_status: "public" },
      ],
      total: 2,
      truncated: false,
    },
    buildPublicArtifactVisibilityContext({
      schema_version: 1,
      revision: 1,
      generated_at: 1,
      entities: [{ entity_type: "video", entity_id: "v-hidden", fence_token: "f", blocked_at: 1 }],
    }),
  );
  assert.deepEqual(filtered?.videos, [{ id: "v-ok", title: "ok", visibility_status: "public" }]);
  assert.equal(filtered?.total, 1);
});

test("enforced fence IDs filter id-only global artifacts", () => {
  const context = buildPublicArtifactVisibilityContext({
    schema_version: 1,
    revision: 2,
    generated_at: 100,
    entities: [
      {
        entity_type: "video",
        entity_id: "v-hidden",
        fence_token: "video-token",
        blocked_at: 90,
      },
      {
        entity_type: "event",
        entity_id: "e-hidden",
        fence_token: "event-token",
        blocked_at: 90,
      },
      {
        entity_type: "event_group",
        entity_id: "group-hidden",
        fence_token: "group-token",
        blocked_at: 90,
      },
      {
        entity_type: "x_user",
        entity_id: "CreatorHidden",
        fence_token: "user-token",
        blocked_at: 90,
      },
    ],
  });
  const filtered = filterPublicArtifactPayload(
    "top",
    {
      items: [{ id: "v-hidden", title: "old" }, { id: "v-ok", title: "ok" }],
      nostalgic_pool: [{ id: "v-hidden", title: "old" }, { id: "v-ok", title: "ok" }],
      active_events: [
        { id: "e-hidden", title: "old" },
        { id: "e-ok", title: "ok" },
      ],
      creators: [
        { id: "creatorhidden", x_name: "old" },
        { id: "creator-ok", x_name: "ok" },
      ],
    },
    context,
  );
  assert.deepEqual(filtered?.items, [{ id: "v-ok", title: "ok" }]);
  assert.deepEqual(filtered?.nostalgic_pool, [{ id: "v-ok", title: "ok" }]);
  assert.deepEqual(filtered?.active_events, [{ id: "e-ok", title: "ok" }]);
  assert.deepEqual(filtered?.creators, [{ id: "creator-ok", x_name: "ok" }]);

  const recent = filterPublicArtifactPayload(
    "list_recent",
    { items: [{ id: "v-hidden", title: "old" }, { id: "v-ok", title: "ok" }] },
    context,
  );
  assert.deepEqual(recent?.items, [{ id: "v-ok", title: "ok" }]);

  const events = filterPublicArtifactPayload(
    "events_index",
    {
      items: [{ id: "e-hidden", title: "old" }, { id: "e-ok", title: "ok" }],
      group_sections: [
        {
          id: "group",
          events: [{ id: "e-hidden", title: "old" }, { id: "e-ok", title: "ok" }],
        },
        {
          id: "group-hidden",
          events: [{ id: "e-ok", title: "still hidden with group" }],
        },
      ],
    },
    context,
  );
  assert.deepEqual(events?.items, [{ id: "e-ok", title: "ok" }]);
  assert.deepEqual(events?.group_sections, [
    { id: "group", events: [{ id: "e-ok", title: "ok" }] },
  ]);

  const users = filterPublicArtifactPayload(
    "users_index",
    { items: [{ x_id: "creatorhidden", x_name: "old" }, { x_id: "ok", x_name: "ok" }] },
    context,
  );
  assert.deepEqual(users?.items, [{ x_id: "ok", x_name: "ok" }]);

  const search = filterPublicArtifactPayload(
    "search_index",
    {
      videos: [{ id: "v-ok", title: "ok" }],
      records: [
        {
          gram: "ok",
          items: [{ id: "v-hidden", title: "old" }, { id: "v-ok", title: "ok" }],
        },
      ],
      users: [{ id: "creatorhidden", x_name: "old" }, { id: "ok", x_name: "ok" }],
    },
    context,
  );
  assert.deepEqual(search?.records?.[0]?.items, [{ id: "v-ok", title: "ok" }]);
  assert.deepEqual(search?.users, [{ id: "ok", x_name: "ok" }]);
});
