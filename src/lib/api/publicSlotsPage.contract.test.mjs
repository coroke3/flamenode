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
  assert.match(page, /is_owned_by_viewer: isOwnedByViewer/);
  assert.match(page, /reserved_x_id_snapshot/);
  assert.match(
    page,
    /reserved_x_id:\s*canReveal[\s\S]*reserved_x_id_snapshot \?\? slot\.x_user_id/,
  );
  assert.match(page, /leftJoin\(videosTable, eq\(slotsTable\.video_id, videosTable\.id\)\)/);
  assert.match(page, /creator_icon_url: videosTable\.creator_icon_url/);
  assert.match(page, /profile_x_user_id:/);
  assert.match(page, /slot-submission-icon\/\$\{slot\.id\}/);
  assert.match(page, /submitted_icon_url: submittedIconUrl/);
  const slotsForUiBlock = page.match(
    /const slotsForUi = slotRows\.map\([\s\S]*?\n  \}\);/,
  );
  assert.ok(slotsForUiBlock, "slotsForUi mapper");
  assert.doesNotMatch(slotsForUiBlock[0], /\bvideo_id\b/);
  assert.match(page, /groupKey = `group-\$\{groupKeys\.size \+ 1\}`/);
  assert.doesNotMatch(page, /viewerUserId=/);
  assert.match(page, /resolveReservationXIdentity/);
  assert.match(
    page,
    /viewerXId=\{viewerXId\}/,
    "viewerXId は resolveReservationXIdentity の結果",
  );
  assert.match(
    page,
    /viewerXId = identity\.snapshotXId/,
    "viewerXId は snapshotXId 由来",
  );
  assert.doesNotMatch(
    page,
    /onboarding\.requestedXId/,
    "requestedXId フォールバックは使わない",
  );
  assert.match(page, /canTakeSlot=\{accepting && onboarding\.canReserveSlot\}/);
  assert.match(page, /canPost=\{onboarding\.canPost\}/);
  assert.doesNotMatch(page, /X ID の申請が必要/);
  assert.match(grid, /reserved_x_id: string \| null/);
  assert.match(grid, /profile_x_user_id\?: string \| null/);
  assert.match(grid, /submitted_icon_url\?: string \| null/);
  assert.match(grid, /取得名義:/);
  assert.match(grid, /Discord のみの参加/);
  assert.doesNotMatch(grid, /disabled=\{[\s\S]*!viewerXId/);
  assert.doesNotMatch(grid, /提出主体:/);
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

test("anonymous and hidden slots expose names only to their owner", () => {
  assert.match(
    page,
    /canReveal[\s\S]*\? slot\.display_name[\s\S]*: null/,
    "display_name visibility gate",
  );
  assert.match(
    page,
    /reserved_x_id:\s*canReveal[\s\S]*\?[\s\S]*: null/,
    "reserved_x_id visibility gate",
  );
  assert.match(
    page,
    /profile_x_user_id:[\s\S]*canReveal && slot\.x_user_id/,
    "profile_x_user_id visibility gate",
  );
  assert.match(
    page,
    /isOwnedByViewer \|\| event\.slot_visibility_mode === "public_name"/,
  );
});
