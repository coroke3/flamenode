import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

test("content-jobs は Queue consumer と Recovery Cron を公開する", () => {
  assert.match(source, /service:\s*"flamenode-content-jobs"/);
  assert.match(source, /BUILD_COMMIT_SHA/);
  assert.match(source, /async queue\(/);
  assert.match(source, /handleStaticRebuildWakeQueue/);
  assert.match(source, /runContentJobsRecovery/);
  assert.match(source, /reconcileStaleQueue/);
  assert.match(source, /ensureDeployGlobalRebuilds/);
  assert.match(source, /ensureDailyTopNostalgicShuffle/);
  assert.match(source, /nostalgicDailyShuffle > 0/);
  assert.match(source, /ensureYoutubeRelatedSharedInputsOnR2/);
  assert.match(source, /ensureUsersSharedInputsOnR2/);
  assert.match(source, /deployGlobalRebuilds > 0/);
  assert.match(source, /shared_related_inputs_missing_on_r2/);
  assert.match(source, /shared_users_inputs_missing_on_r2/);
  assert.match(source, /CONTENT_JOBS_RECOVERY_MAX_TARGETS/);
  assert.match(source, /processStaticRebuildQueue\(rebuildEnv, signal\)/);
  assert.match(
    source,
    /CONTENT_JOBS_RECOVERY_MAX_CONSECUTIVE_EMPTY_PROCESSED/,
  );
  assert.match(source, /staticRebuildHasMore \|\|= Boolean\(result\.hasMore\)/);
  assert.match(source, /result\.skipped \?\? 0\) === 0/);
  assert.doesNotMatch(
    source,
    /if \(!result\.hasMore \|\| result\.processed === 0\)/,
  );
  assert.match(source, /STATIC_REBUILD_WAKE_QUEUE/);
  assert.match(source, /staticRebuildHasMore/);
  assert.match(source, /source:\s*"recovery"/);
  assert.doesNotMatch(source, /context\.waitUntil\(handleStaticRebuildWakeQueue/);
});

test("無認証 rebuild / process-queue を拒否する", () => {
  assert.match(source, /rejectUnauthorizedWorkerRequest/);
  assert.match(source, /\/rebuild/);
  assert.match(source, /\/process-queue/);
});
