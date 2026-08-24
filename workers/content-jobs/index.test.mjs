import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const queueSource = await readFile(
  new URL("../json-generator/queue.ts", import.meta.url),
  "utf8",
);

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
  assert.match(source, /STATIC_REBUILD_WAKE_QUEUE/);
  assert.match(source, /source:\s*"recovery"/);
  assert.doesNotMatch(source, /context\.waitUntil\(handleStaticRebuildWakeQueue/);
});

test("Cron lease・cleanup・rebuildは同じD1 budget wrapperを共有する", () => {
  const envIndex = source.indexOf("const rebuildEnv = rebuildEnvironment(env)");
  const outerLeaseIndex = source.indexOf("const leased = await withCronLease(");
  const cleanupIndex = source.indexOf("const cleanupLease = await withCronLease(");
  const deployIndex = source.indexOf("deployGlobalRebuilds = await ensureDeployGlobalRebuilds(");
  assert.ok(envIndex >= 0 && outerLeaseIndex > envIndex);
  assert.ok(cleanupIndex > outerLeaseIndex && deployIndex > cleanupIndex);
  assert.match(source, /const leased = await withCronLease\(\s*rebuildEnv,/);
  assert.match(source, /const cleanupLease = await withCronLease\(\s*rebuildEnv,/);
  assert.match(source, /runCleanupWithRetry\(rebuildEnv, cleanupSignal\)/);
  assert.doesNotMatch(source, /runCleanupWithRetry\(env, cleanupSignal\)/);
});

test("R2欠落修復は各実装が公開するworst-case予算をsoft limit前に使う", () => {
  assert.match(source, /function hasSoftD1Budget\(/);
  assert.match(source, /budget\.statements \+ requiredStatements <= D1_QUERY_SOFT_LIMIT/);

  for (const name of [
    "DEPLOY_GLOBAL_REBUILD_MAX_D1_STATEMENTS",
    "YOUTUBE_RELATED_REBUILD_MAX_D1_STATEMENTS",
    "USERS_SHARED_REPAIR_MAX_D1_STATEMENTS",
    "TOP_SLOT_STATS_REPAIR_MAX_D1_STATEMENTS",
    "TOP_SECTIONS_REPAIR_MAX_D1_STATEMENTS",
  ]) {
    assert.match(source, new RegExp(`import[\\s\\S]*?${name}`));
    assert.match(
      source,
      new RegExp(`hasSoftD1Budget\\([\\s\\S]*?${name}`),
    );
  }

  assert.doesNotMatch(source, /DEPLOY_GLOBAL_REPAIR_MAX_D1_STATEMENTS\s*=/);
  assert.doesNotMatch(source, /YOUTUBE_SHARED_REPAIR_MAX_D1_STATEMENTS\s*=/);
});

test("stale queue reconcileは実行する3 UPDATE分をsoft limit前に予約する", () => {
  const reservationMatch = source.match(
    /const STALE_QUEUE_RECONCILE_MAX_D1_STATEMENTS = (\d+);/,
  );
  assert.ok(reservationMatch, "reconcile D1 reservation is required");

  const reconcileStart = queueSource.indexOf(
    "export async function reconcileStaleQueue",
  );
  assert.ok(reconcileStart >= 0, "reconcileStaleQueue is required");
  const reconcileSource = queueSource.slice(reconcileStart);
  const actualStatements =
    reconcileSource.match(/env\.DB\.prepare\(/g)?.length ?? 0;

  assert.equal(Number(reservationMatch[1]), actualStatements);
  assert.equal(actualStatements, 3);
  assert.match(
    source,
    /hasSoftD1Budget\([\s\S]*?STALE_QUEUE_RECONCILE_MAX_D1_STATEMENTS[\s\S]*?await reconcileStaleQueue\(rebuildEnv, now, signal\)/,
  );
});

test("Queue wake成功時はCronでstatic rebuildを直接実行しない", () => {
  const delegateIndex = source.indexOf("const delegatedToQueue =");
  const directIndex = source.indexOf("processStaticRebuildQueue(", delegateIndex);
  assert.ok(delegateIndex >= 0 && directIndex > delegateIndex);
  assert.match(source, /const wakeSentKinds = new Set<QueueWakeKind>\(\)/);
  assert.match(source, /sentKinds: wakeSentKinds/);
  assert.match(source, /const rebuild = delegatedToQueue\s*\?/);
  assert.match(source, /skipped: 1,[\s\S]*?hasMore: true/);
  assert.match(source, /: await runJob\([\s\S]*?processStaticRebuildQueue/);
  assert.match(source, /if \(!delegatedToQueue && staticRebuildHasMore\)/);
  assert.doesNotMatch(source, /Queue consumerの長いCPU枠/);
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
