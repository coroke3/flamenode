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
  workersCpuMsPerRequest: 10,
  workerCronTriggersPerAccount: 5,
  d1StatementsPerInvocation: 50,
  queueOperationsPerDay: 10_000,
});

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
assert.ok(Number.isInteger(maxMutationTargets) && maxMutationTargets <= 256);
assert.ok(Number.isInteger(d1TargetsPerUpsert) && d1TargetsPerUpsert > 0);
assert.equal(QUEUE_FREE_TIER_BUDGET.staticRebuildTargetsPerInvocation, 1);
assert.equal(QUEUE_FREE_TIER_BUDGET.maxContinuationPerInvocation, 1);
const maxD1QueueUpsertStatements = Math.ceil(maxMutationTargets / d1TargetsPerUpsert);
const maxMutationQueueOperations = maxMutationTargets * 3;
assert.ok(maxD1QueueUpsertStatements <= 3);
assert.ok(maxMutationQueueOperations <= OFFICIAL_FREE_LIMITS.queueOperationsPerDay);

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
        d1QueueUpsertStatementsAtMaxFanout: maxD1QueueUpsertStatements,
        maxQueueOperationsForOneMutationWithContinuations: maxMutationQueueOperations,
      },
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
