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
  assert.match(source, /ensureEventPlaylistBackfill/);
  assert.match(source, /eventPlaylistBackfill > 0/);
  const reconcileIndex = source.indexOf("await reconcileStaleQueue(rebuildEnv, now, signal)");
  const backfillIndex = source.indexOf("await ensureEventPlaylistBackfill(");
  assert.ok(reconcileIndex >= 0 && backfillIndex > reconcileIndex);
  assert.match(source, /daily top nostalgic enqueue failed/);
  assert.match(source, /nostalgicDailyShuffle > 0/);
  assert.match(source, /ensureYoutubeRelatedSharedInputsOnR2/);
  assert.match(source, /ensureUsersSharedInputsOnR2/);
  assert.match(source, /ensureTopSlotStatsOnR2/);
  assert.match(source, /top_slot_stats_missing_on_r2/);
  assert.match(source, /missingTopSlotStats > 0/);
  assert.match(source, /ensureTopSectionsOnR2/);
  assert.match(source, /top_sections_missing_on_r2/);
  assert.match(source, /missingTopSections > 0/);
  assert.match(source, /deployGlobalRebuilds > 0/);
  assert.match(source, /shared_related_inputs_missing_on_r2/);
  assert.match(source, /shared_users_inputs_missing_on_r2/);
  assert.match(source, /CONTENT_JOBS_RECOVERY_MAX_TARGETS = 3/);
  assert.match(source, /isD1BudgetExhausted\(rebuildEnv\.d1Budget\)/);
  assert.match(source, /rebuildEnvironment/);
  assert.match(
    source,
    /processStaticRebuildQueue\(\s*rebuildEnv,\s*signal,\s*\{ staleQueueAlreadyReconciled: true \}/,
  );
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

test("Cron lease・cleanup・rebuildは同じD1 budget wrapperを共有する", () => {
  const envIndex = source.indexOf("const rebuildEnv = rebuildEnvironment(env)");
  const outerLeaseIndex = source.indexOf("const leased = await withCronLease(");
  const cleanupIndex = source.indexOf("const cleanupLease = await withCronLease(");
  const deployIndex = source.indexOf("const deployGlobalRebuilds = await ensureDeployGlobalRebuilds(");
  assert.ok(envIndex >= 0 && outerLeaseIndex > envIndex);
  assert.ok(cleanupIndex > outerLeaseIndex && deployIndex > cleanupIndex);
  assert.match(
    source,
    /const leased = await withCronLease\(\s*rebuildEnv,/,
  );
  assert.match(
    source,
    /const cleanupLease = await withCronLease\(\s*rebuildEnv,/,
  );
  assert.match(source, /runCleanupWithRetry\(rebuildEnv, cleanupSignal\)/);
  assert.doesNotMatch(source, /runCleanupWithRetry\(env, cleanupSignal\)/);
});

test("手動rebuildもleaseとqueue処理で同じD1 budgetを共有する", () => {
  const manual = source.slice(source.indexOf("export async function handleContentJobsFetch"));
  assert.match(manual, /const rebuildEnv = rebuildEnvironment\(env\)/);
  assert.match(manual, /withCronLease\(\s*rebuildEnv,/);
  assert.match(manual, /queueResult = await runQueue\(rebuildEnv\)/);
});

test("無認証 rebuild / process-queue を拒否する", () => {
  assert.match(source, /rejectUnauthorizedWorkerRequest/);
  assert.match(source, /\/rebuild/);
  assert.match(source, /\/process-queue/);
});
