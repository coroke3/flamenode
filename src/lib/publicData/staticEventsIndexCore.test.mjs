import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeStaticEventsIndex } from "./staticEventsIndexCore.ts";

test("normalizeStaticEventsIndex normalizes events and group sections", () => {
  const index = normalizeStaticEventsIndex({
    generated_at: 100,
    items: [
      {
        id: "event1",
        title: "Event 1",
        visibility_status: "public",
        start_time: 200,
        entry_end_time: 150,
        is_active: 1,
      },
    ],
    group_sections: [
      {
        id: "group1",
        slug: "series",
        name: "Series",
        group_type: "series",
        sort_order: 2,
        latest_event_start_time: 200,
        events: [
          { id: "event1", title: "Event 1", start_time: 200, visibility_status: "public" },
          { id: "missing-title" },
        ],
      },
    ],
  });

  assert.ok(index);
  assert.equal(index.generatedAt, 100);
  assert.equal(index.events.length, 1);
  assert.equal(index.events[0].visibility_status, "public");

  const archived = normalizeStaticEventsIndex({
    items: [{ id: "event2", title: "Event 2", visibility_status: "archived" }],
  });
  assert.ok(archived);
  assert.equal(archived.events[0].visibility_status, "archived");

  assert.equal(index.groupSections.length, 1);
  assert.equal(index.groupSections[0].events.length, 1);
  assert.equal(index.groupSections[0].events[0].id, "event1");
});

test("normalizeStaticEventsIndex rejects payload without items", () => {
  assert.equal(normalizeStaticEventsIndex({ group_sections: [] }), null);
});

test("normalizeStaticEventsIndex drops invalid groups", () => {
  const index = normalizeStaticEventsIndex({
    items: [{ id: "event1", title: "Event 1", visibility_status: "public" }],
    group_sections: [{ id: "group1" }],
  });

  assert.ok(index);
  assert.equal(index.groupSections.length, 0);
});

test("normalizeStaticEventsIndex drops private rows in index and groups", () => {
  const index = normalizeStaticEventsIndex({
    items: [
      { id: "public", title: "Public", visibility_status: "public" },
      { id: "private", title: "Private", visibility_status: "private" },
    ],
    group_sections: [{
      id: "group1", slug: "group", name: "Group", events: [
        { id: "private", title: "Private", visibility_status: "private" },
      ],
    }],
  });
  assert.ok(index);
  assert.deepEqual(index.events.map((event) => event.id), ["public"]);
  assert.equal(index.groupSections[0].events.length, 0);
});
