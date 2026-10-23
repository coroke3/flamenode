import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("mutateWithAudit は notification / static rebuild wake で sentKinds を共有する", async () => {
  const mutate = await readFile(new URL("../../../packages/server-core/src/audit/mutate.ts", import.meta.url), "utf8");
  assert.match(mutate, /const wakeSentKinds/);
  assert.match(mutate, /wakeNotificationQueueAfterCommit\([\s\S]*sentKinds:\s*wakeSentKinds/);
  assert.match(mutate, /wakeStaticRebuildQueueAfterCommit\([\s\S]*sentKinds:\s*wakeSentKinds/);
});
