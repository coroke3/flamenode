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

test("public slots page emits a reduced static base DTO and a viewer overlay", () => {
  assert.match(page, /eq\(eventsTable\.visibility_status, "public"\)/);
  assert.match(page, /EventSlotsViewerPanel/);
  assert.match(page, /if \(event\.slot_visibility_mode === "public_name"\)/);
  assert.match(page, /display_name: slot\.display_name/);
  assert.match(page, /reserved_x_id: slot\.reserved_x_id_snapshot \?\? slot\.x_user_id/);
  assert.match(page, /leftJoin\(videosTable, eq\(slotsTable\.video_id, videosTable\.id\)\)/);
  assert.match(page, /creator_icon_url: videosTable\.creator_icon_url/);
  assert.match(page, /submitted_icon_url:/);
  assert.match(page, /is_owned_by_viewer: false/);
  assert.match(page, /viewer_relation: "none"/);
  assert.match(page, /groupKey = `group-\$\{groupKeys\.size \+ 1\}`/);
  assert.match(page, /baseSlots=\{slotsForUi\}/);
  assert.doesNotMatch(page, /getCurrentUser|resolveReservationXIdentity|viewerUserId=/);

  assert.match(grid, /reserved_x_id: string \| null/);
  assert.match(grid, /profile_x_user_id\?: string \| null/);
  assert.match(grid, /submitted_icon_url\?: string \| null/);
  assert.match(grid, /operatorOverrideAllowed/);
  assert.doesNotMatch(grid, /disabled=\{[\s\S]*!viewerXId/);
  for (const key of [
    "event_id",
    "x_user_id",
    "reserved_by_user_id",
    "discord_id",
    "reservation_group_id",
    "video_id",
    "updated_at",
    "version",
    "creator_icon_url",
  ]) {
    assert.doesNotMatch(grid, new RegExp(`\\b${key}\\s*:`), key);
    assert.doesNotMatch(grouping, new RegExp(`\\b${key}\\s*:`), key);
  }
});

test("anonymous and hidden slots keep viewer-only fields opaque until overlay", () => {
  const publicBranchStart = page.indexOf(
    'if (event.slot_visibility_mode === "public_name")',
  );
  const hiddenBranchStart = page.indexOf("    } else {", publicBranchStart);
  assert.ok(publicBranchStart >= 0 && hiddenBranchStart > publicBranchStart);
  const publicBranch = page.slice(publicBranchStart, hiddenBranchStart);
  const hiddenBranch = page.slice(hiddenBranchStart);
  assert.match(publicBranch, /display_name: slot\.display_name/);
  assert.match(publicBranch, /reserved_x_id: slot\.reserved_x_id_snapshot \?\? slot\.x_user_id/);
  assert.match(hiddenBranch, /display_name: null/);
  assert.match(hiddenBranch, /reserved_x_id: null/);
  assert.match(hiddenBranch, /profile_x_user_id: null/);
  assert.match(hiddenBranch, /x_user_id: null/);
  assert.match(page, /EventSlotsViewerPanel/);
});
