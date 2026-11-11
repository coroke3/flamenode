import assert from "node:assert/strict";
import { test } from "node:test";
import { permissionBatchSchema, upsertSchema, prepareCollaboratorPermissionIntents, parseVideoCollaboratorDeleteInput } from "../src/video/collaboratorPermissionInput.ts";

const intent = (x_user_id = "@Alice") => ({ x_user_id, display_name: "Alice", intent: "on" });

test("MIG-0650 CURRENT/Hono shared batch: canonical X ID and default notify", () => {
  const value = permissionBatchSchema.parse({ video_id: " video ", intents: [intent()] });
  assert.equal(value.video_id, "video");
  assert.equal(value.intents[0].x_user_id, "alice");
  assert.equal(value.notify, true);
});

test("MIG-0650 shared batch rejects invalid handle, unknown privilege mode and over 100 intents", () => {
  for (const xid of ["a/b", "a".repeat(21), "https://evil.example/"]) {
    assert.equal(permissionBatchSchema.safeParse({ video_id: "v", intents: [intent(xid)] }).success, false);
  }
  assert.equal(permissionBatchSchema.safeParse({ video_id: "v", edit_privilege_mode: "root", intents: [intent()] }).success, false);
  assert.equal(permissionBatchSchema.safeParse({ video_id: "v", intents: Array.from({ length: 101 }, () => intent()) }).success, false);
  assert.equal(permissionBatchSchema.safeParse({ video_id: "v", intents: [] }).success, false);
});

test("MIG-0650 shared upsert preserves CURRENT can_edit / notify defaults", () => {
  const base = { video_id: "v", display_name: "Owner" };
  assert.deepEqual(
    (({ can_edit, notify, x_user_id }) => ({ can_edit, notify, x_user_id }))(upsertSchema.parse(base)),
    { can_edit: true, notify: false, x_user_id: "" },
  );
  assert.equal(upsertSchema.parse({ ...base, can_edit: "0", notify: "1", x_user_id: "@A" }).can_edit, false);
  assert.equal(upsertSchema.parse({ ...base, x_user_id: "@A" }).x_user_id, "a");
});

test("MIG-0650 shared canonical intent preparation rejects alias-collapsed duplicates", () => {
  const result = prepareCollaboratorPermissionIntents([
    { x_user_id: "Alice", display_name: "Original", intent: "on" },
    { x_user_id: "@ALICE", display_name: "Shadow", intent: "off" },
    { x_user_id: "bob", display_name: "Bob", intent: "on" },
    { x_user_id: "BOB", display_name: "Duplicate", intent: "off" },
  ]);
  assert.deepEqual(result, {
    ok: false,
    message: "同じ X ID の権限指定が重複しています: @alice、@bob",
  });
});

test("MIG-0650 shared canonical intent preparation preserves ordering and display fallback", () => {
  const result = prepareCollaboratorPermissionIntents([
    { x_user_id: " @ALICE ", display_name: "  ", intent: "on" },
    { x_user_id: "BoB", display_name: " Bob ", intent: "off" },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual([...result.intents], [
    ["alice", { displayName: "@alice", intent: "on" }],
    ["bob", { displayName: "Bob", intent: "off" }],
  ]);
});

test("MIG-0650 shared canonical intent preparation rejects invalid resolved IDs and supports empty", () => {
  assert.deepEqual(prepareCollaboratorPermissionIntents([
    { x_user_id: "../admin", display_name: "Admin", intent: "on" },
  ]), { ok: false, message: "有効な X ID を指定してください。" });
  const result = prepareCollaboratorPermissionIntents([]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.intents.size, 0);
});

test("MIG-0650 delete input keeps CURRENT missing-ID error and canonicalizes handles", () => {
  assert.deepEqual(parseVideoCollaboratorDeleteInput({ video_id: " video ", x_user_id: " @ALICE " }), {
    ok: true, videoId: "video", xUserId: "alice",
  });
  for (const input of [
    {}, { video_id: "  ", x_user_id: "alice" },
    { video_id: "v", x_user_id: "../admin" },
    { video_id: "v", x_user_id: "a".repeat(21) },
  ]) {
    assert.deepEqual(parseVideoCollaboratorDeleteInput(input), {
      ok: false, message: "video_id と有効な X ID が必要です。",
    });
  }
});

test("MIG-0650 delete parser preserves CURRENT string coercion at FormData boundary", () => {
  assert.deepEqual(parseVideoCollaboratorDeleteInput({
    video_id: 123, x_user_id: "@BoB",
  }), { ok: true, videoId: "123", xUserId: "bob" });
});
