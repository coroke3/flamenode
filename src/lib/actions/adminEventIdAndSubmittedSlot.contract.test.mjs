import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readRepoFile(path) {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("event ID rename is admin-only, atomic, and migrates all event references", () => {
  const source = readRepoFile("src/lib/actions/event-admin-danger.ts");

  assert.match(source, /requireAdminWrite\("manage_event_update"\)/);
  assert.match(source, /PRAGMA defer_foreign_keys = on/);

  for (const table of [
    "event_group_events",
    "event_staff",
    "videos",
    "slot_reservation_groups",
    "slots",
    "event_youtube_playlist_sync",
    "event_youtube_playlist_items",
    "video_events",
    "event_custom_questions",
    "video_custom_answers",
    "event_templates",
    "notification_outbox",
    "public_visibility_fences",
  ]) {
    assert.match(source, new RegExp(`UPDATE ${table.replaceAll("_", "_")}`));
  }

  assert.match(source, /event_id_rename_old_cleanup/);
  assert.match(source, /event_id_rename/);
  assert.doesNotMatch(source, /UPDATE static_artifacts/);
});

test("submitted slot force release is admin-only and preserves the video record", () => {
  const source = readRepoFile("src/lib/actions/slot-admin-danger.ts");

  assert.match(source, /requireAdminWrite\("manage_slot_update"\)/);
  assert.match(source, /row\.status !== "submitted"/);
  assert.match(source, /versionedSlotWhere\(row\.event_id, targetRows, "submitted"\)/);
  assert.match(source, /scheduling_type: "manual"/);
  assert.doesNotMatch(source, /delete\(videos\)/);
  assert.doesNotMatch(source, /visibility_status:\s*"voided"/);
});

test("submitted-slot release control is only enabled for global admins", () => {
  const listSource = readRepoFile("src/components/admin/SlotList.tsx");
  const pageSource = readRepoFile("app/(manage)/manage/events/[id]/slots/page.tsx");

  assert.match(listSource, /canForceReleaseSubmitted = false/);
  assert.match(listSource, /forceReleaseSubmittedSlot/);
  assert.match(pageSource, /canForceReleaseSubmitted=\{isAdmin\}/);
});

test("event ID rename control is rendered inside the admin danger section", () => {
  const pageSource = readRepoFile("app/(manage)/manage/events/[id]/edit/page.tsx");

  assert.match(pageSource, /\{isAdmin \? \(/);
  assert.match(pageSource, /<RenameEventIdForm eventId=\{event\.id\} \/>/);
});
