#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  D1_QUERY_HARD_LIMIT,
  D1_QUERY_SOFT_LIMIT,
} from "../workers/shared/d1Budget.ts";
import {
  QUEUE_FREE_TIER_BUDGET,
  QUEUE_NAMES,
} from "../src/lib/queues/wakeBudget.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OFFICIAL_FREE_LIMITS = Object.freeze({
  // Last checked against the official docs linked from the active guardrails.
  workersRequestsPerDay: 100_000,
  workersCpuMsPerRequest: 10,
  workersMemoryMiB: 128,
  workersSubrequestsPerRequest: 50,
  workerCronTriggersPerAccount: 5,
  d1RowsReadPerDay: 5_000_000,
  d1RowsWrittenPerDay: 100_000,
  d1DatabaseStorageMiB: 500,
  d1AccountStorageGiB: 5,
  d1StatementsPerInvocation: 50,
  r2StorageGiBMonth: 10,
  r2ClassAOperationsPerMonth: 1_000_000,
  r2ClassBOperationsPerMonth: 10_000_000,
  kvReadsPerDay: 100_000,
  kvWritesPerDay: 1_000,
  kvDeletesPerDay: 1_000,
  kvListsPerDay: 1_000,
  kvStorageGiB: 1,
  queueOperationsPerDay: 10_000,
});
const MAX_USERS_INDEX_GC_CONTINUATIONS = 10;
const MAX_VIDEO_ARTIFACTS_PER_REBUILD = 2;
const MAX_USER_ARTIFACTS_PER_REBUILD = 9;
const MAX_RANKING_ARTIFACTS_PER_REBUILD = 5;
const MAX_STATIC_LIST_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_USER_INDEX_PAGE_BYTES = 256 * 1024;
const MAX_USER_SEARCH_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;

function readSource(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readIntegerConstant(source, name) {
  const match = source.match(
    new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(\\d+)`),
  );
  assert.ok(match, `missing numeric constant ${name}`);
  return Number(match[1]);
}

function readByteLimit(source, name) {
  const match = source.match(
    new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*([\\d\\s*]+)`),
  );
  assert.ok(match, `missing byte limit ${name}`);
  const factors = match[1]
    .split("*")
    .map((factor) => Number(factor.trim()));
  assert.ok(factors.every((factor) => Number.isInteger(factor) && factor > 0));
  return factors.reduce((total, factor) => total * factor, 1);
}

function extractAsyncFunction(source, name) {
  const start = source.search(new RegExp(`^async function ${name}\\s*\\(`, "m"));
  assert.notEqual(start, -1, `missing async function ${name}`);
  const nextFunction = source.slice(start + 1).search(/^async function /m);
  return source.slice(
    start,
    nextFunction === -1 ? source.length : start + 1 + nextFunction,
  );
}

function readWorkerConfigs() {
  const workersRoot = path.join(REPO_ROOT, "workers");
  return fs
    .readdirSync(workersRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(workersRoot, entry.name, "wrangler.toml"))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => ({
      filePath,
      text: fs.readFileSync(filePath, "utf8"),
    }));
}

function parseCronExpressions(configText) {
  return [...configText.matchAll(/^\s*crons\s*=\s*\[([^\]]*)\]\s*$/gm)]
    .flatMap(([, body]) => [...body.matchAll(/["']([^"']+)["']/g)])
    .map(([, cron]) => cron);
}

function parseQueueConsumerBlocks(configText) {
  return configText
    .split(/(?=^\[\[)/m)
    .filter((block) => /^\[\[queues\.consumers\]\]\s*$/m.test(block));
}

const rootWrangler = fs.readFileSync(path.join(REPO_ROOT, "wrangler.toml"), "utf8");
assert.match(rootWrangler, /^\[assets\][\s\S]*?^run_worker_first\s*=\s*false\s*$/m);
const workerConfigs = readWorkerConfigs();
for (const config of [
  { filePath: path.join(REPO_ROOT, "wrangler.toml"), text: rootWrangler },
  ...workerConfigs,
]) {
  assert.doesNotMatch(
    config.text,
    /^\[limits\]\s*$|^\s*cpu_ms\s*=/m,
    `${path.relative(REPO_ROOT, config.filePath)} must not override the Free CPU budget`,
  );
}
const cronCount = workerConfigs.reduce(
  (count, config) => count + parseCronExpressions(config.text).length,
  parseCronExpressions(rootWrangler).length,
);
assert.ok(
  cronCount <= OFFICIAL_FREE_LIMITS.workerCronTriggersPerAccount,
  `Cron triggers ${cronCount} exceed the Free account cap of ${OFFICIAL_FREE_LIMITS.workerCronTriggersPerAccount}`,
);

const consumers = workerConfigs.flatMap((config) =>
  parseQueueConsumerBlocks(config.text).map((block) => ({
    file: path.relative(REPO_ROOT, config.filePath),
    block,
  })),
);
for (const { file, block } of consumers) {
  const retries = Number(block.match(/^max_retries\s*=\s*(\d+)\s*$/m)?.[1]);
  const concurrency = Number(block.match(/^max_concurrency\s*=\s*(\d+)\s*$/m)?.[1]);
  const batchSize = Number(block.match(/^max_batch_size\s*=\s*(\d+)\s*$/m)?.[1]);
  const deadLetterQueue = block.match(/^dead_letter_queue\s*=\s*["']([^"']+)["']\s*$/m)?.[1];
  assert.ok(Number.isInteger(retries) && retries <= 3, `${file}: queue retries must stay bounded to at most 3`);
  assert.equal(concurrency, QUEUE_FREE_TIER_BUDGET.maxConcurrency, `${file}: queue concurrency drift`);
  assert.ok(Number.isInteger(batchSize) && batchSize <= 10, `${file}: queue batch size exceeds the bounded batch guard`);
  assert.ok(deadLetterQueue, `${file}: every queue consumer must route exhausted retries to a DLQ`);
}

const queueNameCount = Object.keys(QUEUE_NAMES).length;
const normalOperations = QUEUE_FREE_TIER_BUDGET.maxNormalOperationsPerDay;
const reservedOperations = QUEUE_FREE_TIER_BUDGET.reservedOperationsPerDay;
const normalMessages = QUEUE_FREE_TIER_BUDGET.maxNormalMessagesPerDay;
assert.equal(queueNameCount, 6, "wake + DLQ queue inventory changed; review the account-wide budget");
assert.equal(normalMessages * 3, normalOperations, "normal Queue operation estimate must include send/read/delete");
assert.ok(normalOperations + reservedOperations <= OFFICIAL_FREE_LIMITS.queueOperationsPerDay);
assert.ok(
  reservedOperations / OFFICIAL_FREE_LIMITS.queueOperationsPerDay >= 0.4,
  "Queue failure/retry reserve must remain at least 40% of the Free daily allowance",
);
assert.ok(D1_QUERY_SOFT_LIMIT < D1_QUERY_HARD_LIMIT);
assert.ok(D1_QUERY_HARD_LIMIT <= OFFICIAL_FREE_LIMITS.d1StatementsPerInvocation);

const staticRebuildSource = fs.readFileSync(
  path.join(REPO_ROOT, "src/lib/staticRebuild/enqueue.ts"),
  "utf8",
);
const maxMutationTargets = Number(
  staticRebuildSource.match(/MAX_STATIC_REBUILD_BATCH_TARGETS\s*=\s*(\d+)/)?.[1],
);
const d1TargetsPerUpsert = Number(
  staticRebuildSource.match(/STATIC_REBUILD_BULK_UPSERT_ROWS\s*=\s*(\d+)/)?.[1],
);
const usersIndexV2Source = fs.readFileSync(
  path.join(REPO_ROOT, "workers/json-generator/usersIndexV2Artifacts.ts"),
  "utf8",
);
const maxUsersIndexCleanupContinuations = Number(
  usersIndexV2Source.match(/USERS_INDEX_V2_MAX_CLEANUP_CONTINUATIONS\s*=\s*(\d+)/)?.[1],
);
assert.ok(Number.isInteger(maxMutationTargets) && maxMutationTargets <= 256);
assert.ok(Number.isInteger(d1TargetsPerUpsert) && d1TargetsPerUpsert > 0);
assert.ok(
  Number.isInteger(maxUsersIndexCleanupContinuations) &&
    maxUsersIndexCleanupContinuations >= 0 &&
    maxUsersIndexCleanupContinuations <= MAX_USERS_INDEX_GC_CONTINUATIONS,
);
assert.equal(QUEUE_FREE_TIER_BUDGET.staticRebuildTargetsPerInvocation, 1);
assert.equal(QUEUE_FREE_TIER_BUDGET.maxContinuationPerInvocation, 1);
const maxD1QueueUpsertStatements = Math.ceil(maxMutationTargets / d1TargetsPerUpsert);
const maxMutationQueueDeliveries =
  maxMutationTargets + maxUsersIndexCleanupContinuations;
const maxMutationQueueOperations = maxMutationQueueDeliveries * 3;
assert.ok(maxD1QueueUpsertStatements <= 3);
assert.ok(maxMutationQueueOperations <= OFFICIAL_FREE_LIMITS.queueOperationsPerDay);

const rebuildSource = readSource("workers/json-generator/rebuild.ts");
const optimizedRebuildSource = readSource("workers/json-generator/optimizedRebuild.ts");
const videoRebuild = extractAsyncFunction(rebuildSource, "rebuildVideo");
const userRebuild = extractAsyncFunction(rebuildSource, "rebuildUser");
const rankingRebuild = extractAsyncFunction(optimizedRebuildSource, "rebuildRankingBundle");
const videoArtifactKeysPerTarget = (videoRebuild.match(/await putJson\(/g) ?? []).length;
const userPutSites = (userRebuild.match(/await putJson\(/g) ?? []).length;
const userMaxPages = readIntegerConstant(rebuildSource, "STATIC_USER_MAX_PAGES");
const userArtifactKeysPerTarget = 1 + 2 * (userMaxPages - 1);
const rankingTargetSource = optimizedRebuildSource.match(
  /const RANKING_TARGETS = \[([\s\S]*?)\]\s*as const/,
)?.[1];
assert.ok(rankingTargetSource, "missing bounded ranking target inventory");
const rankingTargets = [...rankingTargetSource.matchAll(/["']([^"']+)["']/g)].map(
  ([, target]) => target,
);
const rankingArtifactKeysPerTarget = (rankingRebuild.match(/putTrackedJson\(/g) ?? []).length;
assert.ok(videoArtifactKeysPerTarget <= MAX_VIDEO_ARTIFACTS_PER_REBUILD);
assert.equal(userPutSites, 3, "user target should keep one profile and two paged artifact writers");
assert.ok(userArtifactKeysPerTarget <= MAX_USER_ARTIFACTS_PER_REBUILD);
assert.equal(rankingTargets.length, MAX_RANKING_ARTIFACTS_PER_REBUILD);
assert.equal(
  rankingArtifactKeysPerTarget,
  rankingTargets.length,
  "one ranking rebuild must publish no more artifacts than its tracked target inventory",
);

const publicCreatorProjectionSource = readSource("src/lib/publicData/publicCreatorProjection.ts");
const publicIconProjectionSource = readSource("src/lib/publicData/publicIconProjection.ts");
const userIndexV2CoreSource = readSource("src/lib/publicData/staticUsersIndexV2Core.ts");
const relatedVideoProjectionSource = readSource("src/lib/publicData/relatedVideoProjection.ts");
const eventPlaylistCoreSource = readSource("src/lib/publicData/staticEventPlaylistCore.ts");
const artifactByteLimits = {
  staticList: readByteLimit(rebuildSource, "STATIC_LIST_MAX_OBJECT_BYTES"),
  optimizedStaticList: readByteLimit(optimizedRebuildSource, "STATIC_LIST_MAX_OBJECT_BYTES"),
  legacyUserIndex: readByteLimit(publicCreatorProjectionSource, "USERS_INDEX_MAX_OBJECT_BYTES"),
  publicIconMap: readByteLimit(publicIconProjectionSource, "PUBLIC_X_ICON_MAP_MAX_OBJECT_BYTES"),
  pickupCreators: readByteLimit(publicCreatorProjectionSource, "PICKUP_CREATORS_MAX_OBJECT_BYTES"),
  usersIndexV2Page: readByteLimit(userIndexV2CoreSource, "USERS_INDEX_V2_MAX_PAGE_BYTES"),
  usersSearchLite: readByteLimit(userIndexV2CoreSource, "USERS_SEARCH_LITE_V1_MAX_BYTES"),
  usersIndexManifest: readByteLimit(userIndexV2CoreSource, "USERS_INDEX_V2_MAX_MANIFEST_BYTES"),
  relatedVideoSection: readByteLimit(relatedVideoProjectionSource, "RELATED_SECTION_MAX_BYTES"),
  eventPlaylist: readByteLimit(eventPlaylistCoreSource, "EVENT_PLAYLIST_MAX_OBJECT_BYTES"),
};
assert.equal(artifactByteLimits.staticList, artifactByteLimits.optimizedStaticList);
assert.ok(artifactByteLimits.staticList <= MAX_STATIC_LIST_ARTIFACT_BYTES);
assert.ok(artifactByteLimits.legacyUserIndex <= MAX_STATIC_LIST_ARTIFACT_BYTES);
assert.ok(artifactByteLimits.publicIconMap <= MAX_STATIC_LIST_ARTIFACT_BYTES);
assert.ok(artifactByteLimits.pickupCreators <= 1024 * 1024);
assert.ok(artifactByteLimits.usersIndexV2Page <= MAX_USER_INDEX_PAGE_BYTES);
assert.ok(artifactByteLimits.usersSearchLite <= MAX_USER_SEARCH_ARTIFACT_BYTES);
assert.ok(artifactByteLimits.usersIndexManifest <= MAX_MANIFEST_BYTES);
assert.ok(artifactByteLimits.relatedVideoSection <= 96 * 1024);
assert.ok(artifactByteLimits.eventPlaylist <= MAX_STATIC_LIST_ARTIFACT_BYTES);

console.log(
  JSON.stringify(
    {
      service: "check-free-tier-budget",
      cronTriggers: `${cronCount}/${OFFICIAL_FREE_LIMITS.workerCronTriggersPerAccount}`,
      queue: {
        queues: queueNameCount,
        consumers: consumers.length,
        normalMessagesPerDay: normalMessages,
        normalOperationsPerDay: normalOperations,
        reservedOperationsPerDay: reservedOperations,
        retriesPerMessageMax: 3,
        maxTargetsFromOneMutation: maxMutationTargets,
        maxUsersIndexGcContinuationDeliveries: maxUsersIndexCleanupContinuations,
        maxQueueDeliveriesForOneMutationIncludingUsersIndexGc: maxMutationQueueDeliveries,
        d1QueueUpsertStatementsAtMaxFanout: maxD1QueueUpsertStatements,
        maxQueueOperationsForOneMutationIncludingBoundedUsersIndexGc: maxMutationQueueOperations,
      },
      staticArtifactsPerTarget: {
        videoMaximumKeys: videoArtifactKeysPerTarget,
        userMaximumKeys: userArtifactKeysPerTarget,
        userPageLimit: userMaxPages,
        rankingMaximumKeys: rankingArtifactKeysPerTarget,
        rankingTargetInventory: rankingTargets,
        sameContentDedupMayReducePutOperations: true,
      },
      artifactByteLimits,
      freeTierLimits: OFFICIAL_FREE_LIMITS,
      d1StatementsPerInvocation: {
        soft: D1_QUERY_SOFT_LIMIT,
        hard: D1_QUERY_HARD_LIMIT,
        freeLimit: OFFICIAL_FREE_LIMITS.d1StatementsPerInvocation,
      },
      workersCpuMsPerRequest: OFFICIAL_FREE_LIMITS.workersCpuMsPerRequest,
      staticAssetsRunWorkerFirst: false,
    },
    null,
    2,
  ),
);
