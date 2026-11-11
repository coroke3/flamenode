import assert from "node:assert/strict";
import { test } from "node:test";
import { permissionBatchSchema, upsertSchema } from "../src/video/collaboratorPermissionInput.ts";

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
