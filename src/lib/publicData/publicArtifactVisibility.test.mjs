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

test("enforced x-user fences remove member rows and their chapter projections", () => {
  const context = buildPublicArtifactVisibilityContext({
    schema_version: 1,
    revision: 1,
    generated_at: 1,
    entities: [
      {
        entity_type: "x_user",
        entity_id: "BlockedUser",
        fence_token: "x-token",
        blocked_at: 1,
      },
    ],
  });
  const payload = {
    video: { id: "v1", title: "Video", visibility_status: "public" },
    public_members: [
      { id: "member-blocked", x_user_id: "blockeduser", display_name: "Hidden" },
      { id: "member-internal", display_name: "No X identity", x_user_id: null },
    ],
    member_chapters: [
      { id: "chapter-blocked", video_member_id: "member-blocked" },
      { id: "chapter-internal", video_member_id: "member-internal" },
    ],
  };
  const filtered = filterPublicArtifactPayload("video", payload, context);
  assert.deepEqual(filtered?.public_members, [payload.public_members[1]]);
  assert.deepEqual(filtered?.member_chapters, [payload.member_chapters[1]]);
  assert.equal(payload.public_members.length, 2);
});

test("enforced x-user fences remove public event staff without treating row ids as X ids", () => {
  const context = buildPublicArtifactVisibilityContext({
    schema_version: 1,
    revision: 1,
    generated_at: 1,
    entities: [
      {
        entity_type: "x_user",
        entity_id: "blocked",
        fence_token: "x-token",
        blocked_at: 1,
      },
    ],
  });
  const filtered = filterPublicArtifactPayload(
    "event",
    {
      event: { id: "e1", title: "Event", visibility_status: "public" },
      public_staff: [
        { id: "blocked", x_user_id: "other", display_name: "Visible" },
        { id: "row-2", x_user_id: "blocked", display_name: "Hidden" },
      ],
    },
    context,
  );
  assert.deepEqual(filtered?.public_staff, [
    { id: "blocked", x_user_id: "other", display_name: "Visible" },
  ]);
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

test("SEC-712: event playlist excludes individually fenced videos without changing the cached artifact", () => {
  const manifest = {
    schema_version: 1, revision: 7, generated_at: 1700000000,
    entities: [
      { entity_type: "video", entity_id: "v-revoked", fence_token: "tok-v", blocked_at: 1700000000 },
    ],
  };
  const context = buildPublicArtifactVisibilityContext(manifest);
  const original = {
    schema_version: 1, event_id: "evt-public", complete: true,
    generated_at: 1700000000,
    items: [
      { id: "v-public-a", title: "A", display_name: "Author A" },
      { id: "v-revoked", title: "OLD PRIVATE TITLE", display_name: "OLD PRIVATE AUTHOR" },
      { id: "v-public-b", title: "B", display_name: "Author B" },
    ],
  };
  const filtered = filterPublicArtifactPayload("event_slots", original, context);
  assert.ok(filtered && filtered !== original);
  assert.deepEqual(filtered.items.map((row) => row.id), ["v-public-a", "v-public-b"]);
  assert.equal(filtered.complete, true);
  assert.equal(filtered.event_id, "evt-public");
  assert.equal(original.items.length, 3, "source/cached snapshot must not mutate");
  assert.equal(filterPublicArtifactPayload("event_slots", original), original,
    "without an enforce-mode manifest, historical public payload remains unchanged");
  assert.equal(filterPublicArtifactPayload("event_slots", original, buildPublicArtifactVisibilityContext({
    ...manifest, entities: [{ entity_type: "event", entity_id: "evt-public", fence_token: "tok-e", blocked_at: 1700000000 }],
  })), null, "event-level fence must also fail closed for its playlist");
});

test("SEC-712: event_slots slot artifacts remain intact, video flags and 500-item caps remain guarded", () => {
  const context = buildPublicArtifactVisibilityContext({
    schema_version: 1, revision: 1, generated_at: 1,
    entities: [{ entity_type: "video", entity_id: "v-hidden", fence_token: "f", blocked_at: 1 }],
  });
  const slotsArtifact = { generated_at: 1, slots: [{ id: "v-hidden", status: "available" }], slots_summary: { count: 1 } };
  assert.equal(filterPublicArtifactPayload("event_slots", slotsArtifact, context), slotsArtifact,
    "event_slots also denotes the distinct slot availability artifact");
  const items = Array.from({ length: 500 }, (_, i) => ({ id: i === 498 ? "v-hidden" : "v-" + i, title: "Public", display_name: "Author" }));
  const original = { schema_version: 1, event_id: "evt-public", complete: true, items };
  const filtered = filterPublicArtifactPayload("event_slots", original, context);
  assert.equal(filtered.items.length, 499);
  assert.equal(filtered.items.at(-1).id, "v-499", "playlist order preserved after fencing");
  assert.equal(original.items.length, 500);
  const nonPublic = { ...original, items: [
    { id: "v-ok", title: "OK", display_name: "OK" },
    { id: "v-private", title: "private", status: "private", display_name: "private" },
  ] };
  assert.deepEqual(filterPublicArtifactPayload("event_slots", nonPublic)?.items.map((row) => row.id), ["v-ok"]);
});

test("SEC-712: visibility filtering cannot repair an invalid complete playlist", () => {
  const context = buildPublicArtifactVisibilityContext({
    schema_version: 1, revision: 1, generated_at: 1,
    entities: [{ entity_type: "video", entity_id: "v-hidden", fence_token: "f", blocked_at: 1 }],
  });
  const safe = [
    { id: "v-a", title: "A", display_name: "Author A" },
    { id: "v-b", title: "B", display_name: "Author B" },
  ];
  const hidden = { id: "v-hidden", title: "Hidden", display_name: "Hidden", status: "private" };
  const cases = [
    ["501 rows with a removable final row", [
      ...Array.from({ length: 500 }, (_, index) => ({ ...safe[0], id: `v-${index}` })), hidden,
    ]],
    ["null row", [...safe, null]],
    ["malformed hidden row", [...safe, { ...hidden, title: "" }]],
    ["duplicate hidden IDs", [...safe, hidden, { ...hidden }]],
  ];
  for (const [name, items] of cases) {
    const original = { schema_version: 1, event_id: "evt-public", complete: true, items };
    const before = structuredClone(original);
    for (const visibility of [context, undefined]) {
      assert.equal(filterPublicArtifactPayload("event_slots", original, visibility), null, name);
    }
    assert.deepEqual(original, before, `${name}: source remains unchanged`);
  }
});
