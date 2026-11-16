import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { selectVideoMemberPermissionCarry } from "../src/video/memberPermissionCarry.ts";

function row(id, overrides = {}) {
  return {
    id,
    video_id: "video-1",
    x_user_id: "alice",
    name: "Member",
    role: null,
    comment: null,
    order_index: 0,
    can_edit: 0,
    is_public_member: 1,
    edit_granted_by_auth_user_id: null,
    edit_granted_at: null,
    edit_updated_at: null,
    ...overrides,
  };
}
const canonicalIdentity = raw =>
  raw === null || raw === undefined || raw === "" ? "" :
  raw === "legacy_alias" ? "alice" : raw;

// Independently preserve the CURRENT sort/dedupe/hidden-filter observable
// behavior. The migration must not replace "first row wins" with OR-merging.
function currentSelection(rows, canonicalIds, canonicalize) {
  const hiddenIds = rows.filter(entry =>
    entry.is_public_member === 0 &&
    Boolean(canonicalize(entry.x_user_id)) &&
    canonicalIds.has(canonicalize(entry.x_user_id)),
  ).map(entry => entry.id);
  const preference = (a, b) => a.can_edit !== b.can_edit
    ? b.can_edit - a.can_edit
    : a.is_public_member !== b.is_public_member
      ? b.is_public_member - a.is_public_member
      : Buffer.compare(Buffer.from(a.id, "utf8"), Buffer.from(b.id, "utf8"));
  const picked = new Map();
  for (const entry of [...rows].sort(preference)) {
    const xid = canonicalize(entry.x_user_id);
    if (xid && !picked.has(xid)) picked.set(xid, entry.id);
  }
  return { hiddenIds, preferredIds: [...picked.entries()] };
}

test("MIG-0650 U03d-2e: no data, null identities and noncanonical empty keys are fail-closed", () => {
  const empty = selectVideoMemberPermissionCarry([], new Set(["alice"]), canonicalIdentity);
  assert.deepEqual(empty.hiddenCarryRows, []);
  assert.equal(empty.permissionCarryByXId.size, 0);

  const missing = row("null-xid", { x_user_id: null, is_public_member: 0, can_edit: 1 });
  const result = selectVideoMemberPermissionCarry([missing], new Set(["alice"]), canonicalIdentity);
  assert.equal(result.hiddenCarryRows.length, 0);
  assert.equal(result.permissionCarryByXId.size, 0);
});

test("MIG-0650 U03d-2e: editing right wins over public status, then SQLite binary ID tie-break", () => {
  const rows = [
    row("public-no-edit", { can_edit: 0 }),
    row("hidden-edit", { can_edit: 1, is_public_member: 0, edit_granted_by_auth_user_id: "admin1" }),
    row("public-edit-z", { can_edit: 1 }),
    row("public-edit-a", { can_edit: 1, edit_granted_by_auth_user_id: "admin2" }),
  ];
  const result = selectVideoMemberPermissionCarry(rows, new Set(["alice"]), canonicalIdentity);
  assert.equal(result.permissionCarryByXId.get("alice")?.id, "public-edit-a");
  assert.deepEqual(result.hiddenCarryRows.map(x => x.id), ["hidden-edit"]);
  assert.equal(result.permissionCarryByXId.get("alice")?.edit_granted_by_auth_user_id, "admin2");
});

test("MIG-0650 U03d-2e: same edit grant uses public over hidden even when hidden ID sorts first", () => {
  const rows = [
    row("a-hidden", { can_edit: 1, is_public_member: 0 }),
    row("z-public", { can_edit: 1, is_public_member: 1 }),
  ];
  const result = selectVideoMemberPermissionCarry(rows, new Set(["alice"]), canonicalIdentity);
  assert.equal(result.permissionCarryByXId.get("alice")?.id, "z-public");
  assert.deepEqual(result.hiddenCarryRows.map(x => x.id), ["a-hidden"]);
});

test("MIG-0650 U03d-2e: alias maps into canonical ID, never incorrectly authorizes cleanup outside submission", () => {
  const rows = [
    row("alias", { x_user_id: "legacy_alias", is_public_member: 0, can_edit: 1 }),
    row("outsider", { x_user_id: "mallory", is_public_member: 0, can_edit: 1 }),
    row("canonical", { x_user_id: "alice", is_public_member: 1, can_edit: 0 }),
  ];
  const saved = rows.map(x => ({ ...x }));
  const result = selectVideoMemberPermissionCarry(rows, new Set(["alice"]), canonicalIdentity);
  assert.deepEqual(result.hiddenCarryRows.map(x => x.id), ["alias"]);
  assert.equal(result.permissionCarryByXId.get("alice")?.id, "alias");
  // The legacy map includes all identity lookup results, not only submitted X IDs.
  // This must not be confused with hidden rows eligible for cleanup.
  assert.equal(result.permissionCarryByXId.get("mallory")?.id, "outsider");
  assert.deepEqual(rows, saved, "the original DB rows must remain immutable");
});

test("MIG-0650 U03d-2e: deterministic parity with original priority for every selection permutation", () => {
  const rows = [
    row("Z", { x_user_id: "alice", can_edit: 1, is_public_member: 0 }),
    row("あ", { x_user_id: "legacy_alias", can_edit: 1, is_public_member: 1 }),
    row("a", { x_user_id: "alice", can_edit: 1, is_public_member: 1 }),
    row("b", { x_user_id: "alice", can_edit: 0, is_public_member: 1 }),
    row("c", { x_user_id: "bob", can_edit: 0, is_public_member: 0 }),
    row("d", { x_user_id: "bob", can_edit: 1, is_public_member: 0 }),
    row("e", { x_user_id: null, can_edit: 1, is_public_member: 0 }),
  ];
  const ids = new Set(["alice", "bob"]);
  for (let offset = 0; offset < rows.length; offset++) {
    const permuted = [...rows.slice(offset), ...rows.slice(0, offset)];
    const current = currentSelection(permuted, ids, canonicalIdentity);
    const shared = selectVideoMemberPermissionCarry(permuted, ids, canonicalIdentity);
    assert.deepEqual(shared.hiddenCarryRows.map(x => x.id), current.hiddenIds);
    assert.deepEqual([...shared.permissionCarryByXId.entries()].map(([id, value]) => [id, value.id]), current.preferredIds);
  }
});

test("MIG-0650 U03d-2e: shared core is the single source and Next caller controls canonicalization", async () => {
  const source = await readFile(new URL("../../../src/lib/video/replaceVideoMembers.ts", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./video/memberPermissionCarry"], "./src/video/memberPermissionCarry.ts");
  assert.match(source, /from "@flamenode\/server-core\/video\/memberPermissionCarry"/);
  assert.match(source, /selectVideoMemberPermissionCarry\(carryRows, xIdSet, canonicalIdentity\)/);
  assert.match(source, /const canonicalIdentity = \(raw: string \| null \| undefined\): string =>/);
  assert.doesNotMatch(source, /const permissionCarryByXId = new Map/);
  assert.doesNotMatch(source, /const hiddenCarryRows = carryRows\.filter/);
});
