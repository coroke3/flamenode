import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [page, grid, grouping] = await Promise.all([
  readFile(
    new URL("../../../app/(public)/event/[id]/slots/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../../components/event/SlotGrid.tsx", import.meta.url), "utf8"),
  readFile(new URL("../utils/slotGroupingCore.ts", import.meta.url), "utf8"),
]);

test("public slots page selects public events and serializes a reduced viewer DTO", () => {
  assert.ok(
    (page.match(/eq\(eventsTable\.visibility_status, "public"\)/g) ?? [])
      .length >= 2,
  );
  assert.match(page, /resolveSlotViewerRelation/);
  assert.match(page, /canActAsSlotActor\(viewerRelation\)/);
  assert.match(page, /viewer_relation: viewerRelation/);
  assert.match(page, /groupKey = `group-\$\{groupKeys\.size \+ 1\}`/);
  assert.doesNotMatch(page, /viewerUserId=/);
  for (const key of [
    "event_id",
    "x_user_id",
    "reserved_by_user_id",
    "reservation_group_id",
    "video_id",
    "updated_at",
    "version",
  ]) {
    assert.doesNotMatch(grid, new RegExp(`\\b${key}\\s*:`), key);
    assert.doesNotMatch(grouping, new RegExp(`\\b${key}\\s*:`), key);
  }
});

test("anonymous and hidden slots expose names to viewer relations without raw ownership ids", () => {
  assert.match(
    page,
    /viewerRelation === "active"[\s\S]*viewerRelation === "unassigned"[\s\S]*viewerRelation === "account_other"/,
  );
  assert.match(
    page,
    /event\.slot_visibility_mode === "public_name"/,
  );
  assert.match(page, /const isOwnedByViewer = canActAsSlotActor\(viewerRelation\)/);
  assert.match(page, /is_owned_by_viewer: isOwnedByViewer/);
});
