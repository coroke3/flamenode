import assert from "node:assert/strict";
import { test } from "node:test";
import { preparePermissionWrite } from "../src/video/permissionPreparation.ts";

const args = {
  videoId: "v1", actorId: "actor", now: 1700000000,
  notify: true, makeMemberId: () => "vm1",
};

test("SA-084 shared preflight treats empty intents as a terminal no-op without D1", async () => {
  const result = await preparePermissionWrite(null, { ...args, intents: [] });
  assert.deepEqual(result, {
    kind: "terminal",
    result: {
      ok: true, message: "変更対象がありません。",
      granted: [], revoked: [], unchanged: 0,
    },
  });
});

test("SA-084 shared preflight rejects invalid empty X ID before D1 access", async () => {
  const result = await preparePermissionWrite(null, {
    ...args, intents: [{ x_user_id: " @ ", display_name: "Invalid", intent: "on" }],
  });
  assert.equal(result.kind, "error");
  assert.ok(result.message);
});
