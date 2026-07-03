import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildUsedSoftwareJson,
  defaultStaticRebuildStrategy,
  planStaticRebuildEnqueues,
  resolveImportedEventState,
  staticRebuildTargetLabels,
} from "./importState.ts";

test("resolveImportedEventState defaults archive to inactive archived", () => {
  const now = 1_700_000_000;
  assert.deepEqual(
    resolveImportedEventState({
      mode: "archive",
      startTime: now - 86_400,
      endTime: now - 3_600,
      now,
    }),
    {
      visibility_status: "archived",
      is_active: 0,
      is_entry_open: 0,
      is_archived: 1,
    },
  );
});

test("resolveImportedEventState preserve marks ended events archived", () => {
  const now = 1_700_000_000;
  assert.deepEqual(
    resolveImportedEventState({
      mode: "preserve",
      startTime: now - 200_000,
      endTime: now - 10_000,
      now,
    }),
    {
      visibility_status: "archived",
      is_active: 0,
      is_entry_open: 0,
      is_archived: 1,
    },
  );
});

test("resolveImportedEventState active_event stays active", () => {
  const now = 1_700_000_000;
  assert.deepEqual(
    resolveImportedEventState({
      mode: "active_event",
      startTime: now - 10_000,
      endTime: now + 10_000,
      now,
    }),
    {
      visibility_status: "public",
      is_active: 1,
      is_entry_open: 0,
      is_archived: 0,
    },
  );
});

test("resolveImportedEventState draft keeps legacy flags inactive", () => {
  const now = 1_700_000_000;
  assert.deepEqual(
    resolveImportedEventState({
      mode: "draft",
      startTime: now - 10_000,
      endTime: now + 10_000,
      now,
    }),
    {
      visibility_status: "draft",
      is_active: 0,
      is_entry_open: 0,
      is_archived: 0,
    },
  );
});

test("defaultStaticRebuildStrategy uses event for archive import", () => {
  assert.equal(defaultStaticRebuildStrategy("archive", false), "event");
  assert.equal(defaultStaticRebuildStrategy("archive", true), "none");
  assert.equal(defaultStaticRebuildStrategy("draft", false), "none");
});

test("planStaticRebuildEnqueues avoids per-video by default", () => {
  const items = planStaticRebuildEnqueues({
    strategy: "event",
    importMode: "archive",
    eventIds: ["PVSF2024Sp"],
    videoIds: ["v1", "v2"],
    xUserIds: ["x1"],
  });
  const types = items.map((i) => `${i.targetType}:${i.targetId}`);
  assert.ok(types.includes("event:PVSF2024Sp"));
  assert.ok(!types.some((t) => t.startsWith("video:")));
});

test("staticRebuildTargetLabels mirrors archive event enqueue plan", () => {
  const labels = staticRebuildTargetLabels("event", "archive", ["PVSF2024Sp"]);
  assert.deepEqual(labels, ["events_index", "search_index", "event:PVSF2024Sp"]);
});

test("staticRebuildTargetLabels includes list_recent for non-archive summary", () => {
  const labels = staticRebuildTargetLabels("summary", "active_event", ["PVSF2024Sp"]);
  assert.deepEqual(labels, ["events_index", "search_index", "list_recent"]);
});

test("staticRebuildTargetLabels returns none for draft mode", () => {
  const labels = staticRebuildTargetLabels("event", "draft", ["PVSF2024Sp"]);
  assert.deepEqual(labels, ["なし"]);
});

test("staticRebuildTargetLabels shows wildcard detail targets for full strategy", () => {
  const labels = staticRebuildTargetLabels("full", "active_event", ["PVSF2024Sp"]);
  assert.ok(labels.includes("video:*"));
  assert.ok(labels.includes("user:*"));
});

test("buildUsedSoftwareJson stores legacy items", () => {
  const raw = buildUsedSoftwareJson(["After Effects", "Blender"]);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.source, "legacy");
  assert.deepEqual(parsed.items, ["After Effects", "Blender"]);
});

test("buildUsedSoftwareJson parses comma-separated string", () => {
  const raw = buildUsedSoftwareJson("After Effects, Blender");
  const parsed = JSON.parse(raw);
  assert.deepEqual(parsed.items, ["After Effects", "Blender"]);
});
