// MIG-0306 U02: X ID merge/revert relation-state planner (pure part only).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildXIdMergeAfterState,
  buildXIdMergeBeforeState,
} from "@flamenode/domain/xid";

const source = "old_name";
const target = "current_name";
const now = 500;

function staff(id, eventId, xUserId, preset) {
  return { id, event_id: eventId, x_user_id: xUserId, permission_preset: preset, updated_at: 1 };
}

function snapshot() {
  return {
    source_x_user: { id: source, approval_status: "approved" },
    target_x_user: { id: target, approval_status: "approved" },
    active_users: [
      { id: "auth-a", active_x_user_id: "@Old_Name" },
      { id: "auth-c", active_x_user_id: target },
    ],
    account_links: [
      { x_user_id: source, auth_user_id: "auth-a", link_role: "owner", created_by_request_id: null, updated_at: 1 },
      { x_user_id: source, auth_user_id: "auth-b", link_role: "manager", created_by_request_id: "req-b", updated_at: 1 },
      { x_user_id: target, auth_user_id: "auth-a", link_role: "manager", created_by_request_id: "req-a", updated_at: 1 },
      { x_user_id: target, auth_user_id: "auth-c", link_role: "owner", created_by_request_id: null, updated_at: 1 },
    ],
    videos: [{ id: "v1", creator_x_user_id: source, updated_at: 1 }],
    video_chapters: [],
    video_members: [{ id: "m1", x_user_id: source }],
    slots: [{ id: "s1", x_user_id: null, reserved_x_id_snapshot: "@OLD_NAME", updated_at: 1, version: 3 }],
    video_interactions: [
      { x_user_id: source, video_id: "v9", interaction_type: "like", created_at: 1 },
      { x_user_id: target, video_id: "v9", interaction_type: "like", created_at: 2 },
      { x_user_id: source, video_id: "v8", interaction_type: "bookmark", created_at: 3 },
    ],
    event_staff: [
      staff("st-src", "e1", source, "owner"),
      staff("st-tgt", "e1", target, "editor"),
      staff("st-src2", "e2", source, "viewer"),
    ],
    aliases: [{ x_user_id: source, alias_x_id: "older_name" }],
  };
}

test("T01: after-state moves every active reference, and replanning is deterministic", () => {
  const input = { sourceXUserId: source, targetXUserId: target, now };
  const after = buildXIdMergeAfterState(snapshot(), input);
  assert.deepEqual(buildXIdMergeAfterState(snapshot(), input), after, "re-run yields the same plan");
  assert.deepEqual(after.x_users, [
    { id: source, approval_status: "rejected" },
    { id: target, approval_status: "approved" },
  ]);
  assert.deepEqual(after.videos, [{ id: "v1", creator_x_user_id: target, updated_at: now }]);
  assert.deepEqual(after.slots[0], {
    id: "s1", x_user_id: null, reserved_x_id_snapshot: target, updated_at: now, version: 4,
  });
  assert.deepEqual(after.active_users.map((row) => row.active_x_user_id), [target, target]);
  // overlapping owner: the source owner row is dropped and the target row is promoted
  assert.deepEqual(after.event_staff.map((row) => [row.id, row.x_user_id, row.permission_preset]), [
    ["st-tgt", target, "owner"],
    ["st-src2", target, "viewer"],
  ]);
  assert.deepEqual(after.aliases, [
    { x_user_id: target, alias_x_id: "older_name" },
    { x_user_id: target, alias_x_id: source },
  ]);
});

test("T01: before-state is an isolated copy, so the revert target cannot drift", () => {
  const snap = snapshot();
  const before = buildXIdMergeBeforeState(snap);
  snap.videos[0].creator_x_user_id = "mutated";
  assert.equal(before.videos[0].creator_x_user_id, source);
  assert.deepEqual(before.x_users, [
    { id: source, approval_status: "approved" },
    { id: target, approval_status: "approved" },
  ]);
  assert.deepEqual(before.slot_reservation_groups, []);
  assert.deepEqual(before.video_moderation_cases, []);
});

test("T02: one X with several Auth Users keeps one link per Auth User, owner wins", () => {
  const after = buildXIdMergeAfterState(snapshot(), { sourceXUserId: source, targetXUserId: target, now });
  assert.deepEqual(
    after.account_links.map((row) => [row.auth_user_id, row.x_user_id, row.link_role, row.created_by_request_id]),
    [
      ["auth-a", target, "owner", "req-a"],
      ["auth-c", target, "owner", null],
      ["auth-b", target, "manager", "req-b"],
    ],
  );
});

test("shared X like duplicates: the target interaction wins, others move", () => {
  const after = buildXIdMergeAfterState(snapshot(), { sourceXUserId: source, targetXUserId: target, now });
  assert.deepEqual(after.video_interactions, [
    { x_user_id: target, video_id: "v9", interaction_type: "like", created_at: 2 },
    { x_user_id: target, video_id: "v8", interaction_type: "bookmark", created_at: 3 },
  ]);
});
