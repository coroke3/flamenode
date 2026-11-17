import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildVideoMemberReplacementRows } from "../src/video/memberReplacementRows.ts";

const normalizeXId = raw =>
  typeof raw === "string" ? raw.trim().replace(/^@/, "").toLowerCase() : "";
const canonicalIdentity = raw => {
  const id = normalizeXId(raw);
  return id === "former_alice" ? "alice" : id;
};
function row(id, values = {}) {
  return {
    id, video_id: "video-1", x_user_id: null, name: "Member",
    role: null, comment: null, order_index: 0, can_edit: 0,
    is_public_member: 1, edit_granted_by_auth_user_id: null,
    edit_granted_at: null, edit_updated_at: null, ...values,
  };
}
function member(name, x_user_id = "", role = "", comment = "") {
  return { name, x_user_id, role, comment };
}
function build(input = {}) {
  let generated = 0;
  const data = {
    videoId: "video-1",
    members: [],
    existingPublic: [],
    permissionCarryByXId: new Map(),
    existingXIds: new Set(),
    canonicalIdentity,
    normalizeXId,
    generateMemberId: () => "vm_generated_" + ++generated,
    ...input,
  };
  const result = buildVideoMemberReplacementRows(data);
  return { ...result, generated, data };
}

test("MIG-0650 U03d-2g: empty submission is a no-op without generated IDs", () => {
  const result = build();
  assert.deepEqual(result.nextMembers, []);
  assert.deepEqual(result.newXUsers, []);
  assert.equal(result.generated, 0);
});

test("MIG-0650 U03d-2g: pending x_users are deduplicated, source X ID set stays immutable", () => {
  const existingXIds = new Set(["already"]);
  const result = build({
    members: [
      member("First", "@DUP", "direction", "note"),
      member("Second", "dup", "camera"),
      member("Third", "already"),
      member("", "empty_name"),
    ],
    existingXIds,
  });
  assert.deepEqual(result.newXUsers.map(x => x.id), ["dup", "empty_name"]);
  assert.deepEqual(result.newXUsers.map(x => x.approval_status), ["pending", "pending"]);
  assert.equal(result.newXUsers[0].x_name, "First");
  assert.equal(result.newXUsers[1].x_name, "@empty_name");
  assert.deepEqual([...existingXIds], ["already"]);
  assert.equal(result.nextMembers[0].role, "direction");
  assert.equal(result.nextMembers[0].comment, "note");
  assert.equal(result.nextMembers[0].x_user_id, "dup");
  assert.deepEqual(result.nextMembers.map(x => x.order_index), [0, 1, 2, 3]);
  assert.equal(result.generated, 4);
});

test("MIG-0650 U03d-2g: reused public IDs and write metadata have precedence over hidden carry", () => {
  const publicRow = row("vm_original", {
    x_user_id: "alice", name: "Alice",
    can_edit: 0, edit_granted_by_auth_user_id: "public",
    edit_granted_at: 11, edit_updated_at: 12,
  });
  const carryRow = row("vm_hidden", {
    x_user_id: "former_alice", is_public_member: 0,
    can_edit: 1, edit_granted_by_auth_user_id: "hidden",
    edit_granted_at: 22, edit_updated_at: 23,
  });
  const result = build({
    existingPublic: [publicRow],
    existingXIds: new Set(["alice"]),
    permissionCarryByXId: new Map([["alice", carryRow]]),
    members: [member("Alice new", "alice", "", "")],
  });
  assert.equal(result.generated, 0);
  assert.equal(result.nextMembers[0].id, "vm_original");
  assert.equal(result.nextMembers[0].can_edit, 1);
  assert.equal(result.nextMembers[0].edit_granted_by_auth_user_id, "hidden");
  assert.equal(result.nextMembers[0].edit_granted_at, 22);
  assert.equal(result.nextMembers[0].edit_updated_at, 23);
  assert.equal(result.nextMembers[0].is_public_member, 1);
  assert.deepEqual(result.newXUsers, []);
});

test("MIG-0650 U03d-2g: canonical alias matches old public row, but requires canonicalized input for reuse", () => {
  const oldPublic = row("vm_alias", {
    x_user_id: "former_alice", name: "Legacy user", can_edit: 1,
  });
  const result = build({
    existingPublic: [oldPublic],
    existingXIds: new Set(["alice"]),
    members: [member("Renamed", "alice")],
  });
  assert.equal(result.nextMembers[0].id, "vm_alias");
  assert.equal(result.nextMembers[0].can_edit, 0,
    "CURRENT xId path reads permissionCarryByXId, not previousPublic: never invent grants");
  assert.equal(result.generated, 0);
});

test("MIG-0650 U03d-2g: X-less matches NFKC normalized lower-case name, grants follow previous public row", () => {
  const oldPublic = row("vm_name", {
    x_user_id: null, name: " ＡＬＩＣＥ ",
    can_edit: 1, edit_granted_by_auth_user_id: "approved-admin",
  });
  const result = build({
    existingPublic: [oldPublic],
    members: [member("alice", "", "  ", "")],
  });
  assert.equal(result.generated, 0);
  assert.equal(result.nextMembers[0].id, "vm_name");
  assert.equal(result.nextMembers[0].can_edit, 1);
  assert.equal(result.nextMembers[0].edit_granted_by_auth_user_id, "approved-admin");
  assert.equal(result.nextMembers[0].role, null);
  assert.equal(result.nextMembers[0].x_user_id, null);
});

test("MIG-0650 U03d-2g: first matching legacy row wins, no grants for unrelated X IDs", () => {
  const first = row("first", { x_user_id: "alice", can_edit: 1 });
  const second = row("second", { x_user_id: "alice", can_edit: 0 });
  const result = build({
    existingPublic: [first, second],
    members: [member("Person", "alice"), member("Other", "outsider")],
  });
  assert.equal(result.nextMembers[0].id, "first");
  assert.equal(result.nextMembers[0].can_edit, 0,
    "CURRENT forbids inheriting X-ID permissions from previousPublic when carry map is empty");
  assert.equal(result.nextMembers[1].id, "vm_generated_1");
  assert.equal(result.nextMembers[1].can_edit, 0);
  assert.deepEqual(result.newXUsers.map(x => x.id), ["alice", "outsider"]);
});

test("MIG-0650 U03d-2g: source arrays, map and set are not mutated or reused across calls", () => {
  const original = row("old", { x_user_id: "alice" });
  const members = [member("Alice", "alice"), member("Alice second", "alice")];
  const existingPublic = [original];
  const carryMap = new Map([["alice", original]]);
  const known = new Set(["alice"]);
  const data = { members, existingPublic, permissionCarryByXId: carryMap, existingXIds: known };
  const a = build(data);
  const b = build(data);
  assert.deepEqual(a.nextMembers, b.nextMembers);
  assert.deepEqual(a.newXUsers, b.newXUsers);
  assert.deepEqual(existingPublic, [original]);
  assert.deepEqual(members, [member("Alice", "alice"), member("Alice second", "alice")]);
  assert.deepEqual([...known], ["alice"]);
  assert.deepEqual([...carryMap.keys()], ["alice"]);
});

test("MIG-0650 U03d-2g: Next writer invokes shared projection, retaining canonical resolution and CAS", async () => {
  const legacy = await readFile(new URL("../../../src/lib/video/replaceVideoMembers.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/memberReplacementRows"], "./src/video/memberReplacementRows.ts");
  assert.match(legacy, /from "@flamenode\/server-core\/video\/memberReplacementRows"/);
  assert.match(legacy, /buildVideoMemberReplacementRows\(\{/);
  assert.match(legacy, /canonicalizeMemberInputs\(db, args\.members\)/);
  assert.match(legacy, /normalizeXId/);
  assert.match(legacy, /generateMemberId: \(\) => generateId\("vm"\)/);
  assert.match(legacy, /buildVideoMemberSetGuardSql/);
  assert.doesNotMatch(legacy, /const existingPublicByXId = new Map/);
  assert.doesNotMatch(legacy, /const nextMembers: Array</);
});
