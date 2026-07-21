import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(path) {
  return readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
}

const retiredEventAndSlotFields = [
  "max_consecutive_slots_per_entry",
  "slot_kind",
  "priority_reclaim_video_id",
  "priority_reclaim_until",
];

test("owner正本はevent_staff.permission_presetだけを使う", async () => {
  const [ownership, eventAdmin] = await Promise.all([
    source("src/lib/event/eventOwnership.ts"),
    source("src/lib/actions/event-admin.ts"),
  ]);
  assert.match(ownership, /permission_preset/);
  assert.match(ownership, /transferEventOwnership/);
  assert.doesNotMatch(ownership, /representative_x_user_id/);
  assert.match(eventAdmin, /db\.insert\(eventStaff\)\.values\(ownerRow\)/);
  assert.match(eventAdmin, /permission_preset:\s*"owner"/);
  assert.match(eventAdmin, /active_x_user_id/);
});

test("枠処理はreservation_group_idとmax_slots_per_videoを維持する", async () => {
  const [slotAction, submitAction, slotGrid] = await Promise.all([
    source("src/lib/actions/slot.ts"),
    source("src/lib/actions/video/submitSlotVideo.ts"),
    source("src/components/event/SlotGrid.tsx"),
  ]);
  const combined = `${slotAction}\n${submitAction}\n${slotGrid}`;
  assert.match(slotAction, /event\.max_slots_per_video/);
  assert.match(slotAction, /extendOwnSlotGroup/);
  assert.match(slotAction, /mergeOwnSlotGroups/);
  assert.match(submitAction, /eventConfig\.max_slots_per_video/);
  assert.match(submitAction, /reservation_group_id/);
  assert.match(slotGrid, /collapseReservationGroups/);
  for (const retired of retiredEventAndSlotFields) {
    assert.doesNotMatch(combined, new RegExp(retired));
  }
});

test("イベントグループと公開Workerは修正後正本だけを読む", async () => {
  const [groupQuery, worker, queries, adminGroupsPage] = await Promise.all([
    source("src/lib/db/eventGroups.ts"),
    source("workers/json-generator/rebuild.ts"),
    source("src/lib/db/queries.ts"),
    source("app/(admin)/admin/event-groups/page.tsx"),
  ]);
  assert.match(groupQuery, /desc\(events\.start_time\)/);
  assert.match(groupQuery, /desc\(events\.created_at\)/);
  assert.match(groupQuery, /orderBy\(asc\(eventGroups\.sort_order\), asc\(eventGroups\.name\)\)/);
  assert.doesNotMatch(groupQuery, /eventGroupEvents\.sort_order/);
  assert.match(worker, /ORDER BY sort_order ASC, name ASC/);
  assert.match(worker, /ORDER BY e\.start_time DESC, e\.created_at DESC/);
  assert.match(adminGroupsPage, /orderBy\(asc\(eventGroups\.sort_order\), asc\(eventGroups\.name\)\)/);
  assert.doesNotMatch(worker, /max_consecutive_slots_per_entry/);
  assert.doesNotMatch(worker, /es\.role/);
  assert.doesNotMatch(queries, /eventStaff\.role/);
});

test("公開イベントAPIは明示DTOと漏えい検査を通す", async () => {
  const [route, endpoint] = await Promise.all([
    source("app/api/events/route.ts"),
    source("src/lib/actions/api-endpoints.ts"),
  ]);
  assert.match(route, /PUBLIC_EVENT_KEYS/);
  assert.match(route, /assertNoForbiddenKeys/);
  assert.match(endpoint, /before\.updated_at/);
  assert.match(endpoint, /updated_at:\s*now/);
  assert.doesNotMatch(endpoint, /public_api_updated_at/);
});
