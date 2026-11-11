import assert from "node:assert/strict";
import { test } from "node:test";
import { planVideoPermissionChanges, evaluatePermissionPlanPreflight } from "../src/video/permissionPlan.ts";

const member = (id, xid, publicMember, canEdit, extra = {}) => ({
  id, video_id: "v1", x_user_id: xid, name: id, role: null, comment: null,
  order_index: 0, can_edit: canEdit, is_public_member: publicMember,
  edit_granted_by_auth_user_id: null, edit_granted_at: null, edit_updated_at: null,
  ...extra,
});
const plan = ({ intents, rowsByXid = new Map(), profiles = [], count = 0, notify = true } = {}) =>
  planVideoPermissionChanges({
    intents: new Map(intents ?? []), rowsByXid, existingProfileIds: new Set(profiles),
    actorId: "actor", videoId: "v1", now: 1700000000, notify,
    makeMemberId: () => "new-member", currentHiddenEditorCount: count,
  });

test("MIG-0650 plan: public row grant retains existing editor grant and deletes hidden duplicate", () => {
  const p = member("public", "alice", 1, 0);
  const h = member("hidden", "alice", 0, 1, {
    edit_granted_by_auth_user_id: "old-actor", edit_granted_at: 10, edit_updated_at: 20,
  });
  const result = plan({ intents: [["alice", { displayName: "Alice", intent: "on" }]],
    rowsByXid: new Map([["alice", [p, h]]]), profiles: ["alice"], count: 1 });
  assert.deepEqual(result.updateRows.map(row => [row.id,row.can_edit,row.edit_granted_by_auth_user_id,row.edit_granted_at]), [
    ["public",1,"old-actor",10],
  ]);
  assert.deepEqual(result.deleteHiddenIds, ["hidden"]);
  assert.deepEqual(result.grantedNames, []);
  assert.equal(result.unchanged, 1);
  assert.equal(result.nextHiddenEditorCount, 0);
  assert.deepEqual(result.notifyXids, []);
});

test("MIG-0650 plan: off revokes all public permissions, deletes hidden rows and notifies nobody", () => {
  const result = plan({ intents: [["alice", { displayName: "Alice", intent: "off" }]],
    rowsByXid: new Map([["alice", [
      member("p1","alice",1,1), member("p2","alice",1,0),
      member("h1","alice",0,1), member("h2","alice",0,0),
    ]]]), profiles: ["alice"], count: 2 });
  assert.deepEqual(result.updateRows.map(row => row.id), ["p1"]);
  assert.equal(result.updateRows[0].can_edit, 0);
  assert.deepEqual(result.deleteHiddenIds, ["h1", "h2"]);
  assert.deepEqual(result.revokedNames, ["Alice @alice"]);
  assert.equal(result.nextHiddenEditorCount, 0);
  assert.deepEqual(result.notifyXids, []);
});

test("MIG-0650 plan: new X identity and hidden edit are created together", () => {
  const result = plan({ intents: [["bob", { displayName: "Bob", intent: "on" }]] });
  assert.deepEqual(result.newXUsers.map(x => [x.id,x.approval_status]), [["bob","pending"]]);
  assert.deepEqual(result.insertHiddenRows.map(x => [x.id,x.video_id,x.can_edit,x.is_public_member]),
    [["new-member","v1",1,0]]);
  assert.deepEqual(result.grantedNames, ["Bob @bob"]);
  assert.deepEqual(result.notifyXids, ["bob"]);
  assert.equal(result.nextHiddenEditorCount, 1);
  const silent = plan({ intents: [["bob", { displayName: "Bob", intent: "on" }]], notify: false });
  assert.deepEqual(silent.notifyXids, []);
});

test("MIG-0650 plan: hidden duplicates shrink on grant; profile set is not mutated", () => {
  const profiles = new Set(["alice"]);
  const result = planVideoPermissionChanges({
    intents: new Map([["alice", { displayName: "Alice", intent: "on" }]]),
    rowsByXid: new Map([["alice", [
      member("h1","alice",0,1), member("h2","alice",0,1),
    ]]]), existingProfileIds: profiles, actorId: "actor", videoId: "v1",
    now: 1700000000, notify: true, makeMemberId: () => "new", currentHiddenEditorCount: 2,
  });
  assert.deepEqual(result.deleteHiddenIds, ["h2"]);
  assert.equal(result.nextHiddenEditorCount, 1);
  assert.equal(result.unchanged, 1);
  assert.deepEqual([...profiles], ["alice"]);
});

test("MIG-0650 preflight refuses a 101st hidden editor when a new hidden row is inserted", () => {
  const candidate = plan({
    intents: [["alice", { displayName: "Alice", intent: "on" }]],
    count: 100,
  });
  assert.equal(candidate.insertHiddenRows.length, 1);
  assert.deepEqual(evaluatePermissionPlanPreflight(candidate), {
    kind: "limit_exceeded",
    result: {
      ok: false,
      message: "非公開編集者は最大100人です。これ以上編集権を付与できません。",
    },
  });
});

test("MIG-0650 preflight accepts net-zero hidden editor replacement at the 100-person limit", () => {
  const candidate = plan({
    intents: [
      ["alice", { displayName: "Alice", intent: "off" }],
      ["bob", { displayName: "Bob", intent: "on" }],
    ],
    rowsByXid: new Map([
      ["alice", [member("old", "alice", 0, 1)]],
    ]),
    profiles: ["alice", "bob"],
    count: 100,
  });
  assert.deepEqual(candidate.deleteHiddenIds, ["old"]);
  assert.equal(candidate.insertHiddenRows.length, 1);
  assert.equal(candidate.nextHiddenEditorCount, 100);
  assert.deepEqual(evaluatePermissionPlanPreflight(candidate), { kind: "write_required" });
});

test("MIG-0650 preflight returns CURRENT no-op message when no physical mutation is needed", () => {
  const candidate = plan({
    intents: [["alice", { displayName: "Alice", intent: "on" }]],
    rowsByXid: new Map([["alice", [member("existing", "alice", 1, 1)]]]),
    profiles: ["alice"],
  });
  assert.deepEqual(evaluatePermissionPlanPreflight(candidate), {
    kind: "no_changes",
    result: {
      ok: true,
      message: "編集権限を反映しました（付与 0 / 解除 0 / 変更なし 1）",
      granted: [],
      revoked: [],
      unchanged: 1,
    },
  });
});

test("MIG-0650 preflight still schedules CAS write for duplicate-hidden cleanup", () => {
  const candidate = plan({
    intents: [["alice", { displayName: "Alice", intent: "on" }]],
    rowsByXid: new Map([["alice", [
      member("public", "alice", 1, 1),
      member("hidden", "alice", 0, 1),
    ]]]),
    profiles: ["alice"],
    count: 1,
  });
  assert.equal(candidate.updateRows.length, 0);
  assert.deepEqual(candidate.deleteHiddenIds, ["hidden"]);
  assert.deepEqual(evaluatePermissionPlanPreflight(candidate), { kind: "write_required" });
});
