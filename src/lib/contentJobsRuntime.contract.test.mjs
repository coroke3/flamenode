import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = await readFile(
  path.join(process.cwd(), "workers/content-jobs/index.ts"),
  "utf8",
);

test("content-jobs repair catches never swallow lease aborts", () => {
  const recoveryStart = source.indexOf("export async function runContentJobsRecovery");
  const recoveryEnd = source.indexOf("export async function handleContentJobsFetch", recoveryStart);
  const recovery = source.slice(recoveryStart, recoveryEnd);

  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  assert.match(
    recovery,
    /reconcilePendingXIdSlotBinds[\s\S]*?catch \(error\) \{\s*signal\.throwIfAborted\(\);/,
  );
  assert.match(
    recovery,
    /ensureEventPlaylistBackfill[\s\S]*?catch \(error\) \{\s*signal\.throwIfAborted\(\);/,
  );
  assert.match(
    recovery,
    /ensureDailyTopNostalgicShuffle[\s\S]*?catch \(error\) \{\s*signal\.throwIfAborted\(\);/,
  );

  const finalRepairAbort = recovery.indexOf("signal.throwIfAborted();", recovery.indexOf("nostalgicDailyShuffle"));
  const wakeBlock = recovery.indexOf("deployGlobalRebuilds > 0", finalRepairAbort);
  assert.ok(finalRepairAbort >= 0 && wakeBlock > finalRepairAbort);
});
