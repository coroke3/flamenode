/**
 * Cloudflare Queues Free 枠の運用推計。
 * 正本定数: src/lib/queues/wakeBudget.ts
 *
 * Usage: node scripts/estimate-queue-budget.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { QUEUE_FREE_TIER_BUDGET } from "../src/lib/queues/wakeBudget.ts";

/** 1 wake あたりの典型 operations（send + receive + ack） */
const OPS_PER_NORMAL_WAKE = 3;
/** retry 1回あたりの追加 ops 目安 */
const OPS_PER_RETRY = 2;
const MAX_BUSY_DAY_OPERATIONS = 7_000;

const enqueueSource = fs.readFileSync(
  new URL("../src/lib/staticRebuild/enqueue.ts", import.meta.url),
  "utf8",
);
const MAX_MUTATION_TARGETS = Number(
  enqueueSource.match(/MAX_STATIC_REBUILD_BATCH_TARGETS\s*=\s*(\d+)/)?.[1],
);
assert.ok(Number.isInteger(MAX_MUTATION_TARGETS) && MAX_MUTATION_TARGETS > 0);
const usersIndexV2Source = fs.readFileSync(
  new URL("../workers/json-generator/usersIndexV2Artifacts.ts", import.meta.url),
  "utf8",
);
const MAX_USERS_INDEX_GC_CONTINUATIONS = Number(
  usersIndexV2Source.match(/USERS_INDEX_V2_MAX_CLEANUP_CONTINUATIONS\s*=\s*(\d+)/)?.[1],
);
assert.ok(
  Number.isInteger(MAX_USERS_INDEX_GC_CONTINUATIONS) &&
    MAX_USERS_INDEX_GC_CONTINUATIONS >= 0 &&
    MAX_USERS_INDEX_GC_CONTINUATIONS <= 10,
);

function estimate({
  label,
  wakesPerDay,
  retriesPerDay = 0,
  continuationsPerDay = 0,
}) {
  const messages = wakesPerDay + continuationsPerDay;
  const normalOperations = messages * OPS_PER_NORMAL_WAKE;
  const retryOperations = retriesPerDay * OPS_PER_RETRY;
  const operations = normalOperations + retryOperations;
  return {
    label,
    messages,
    normalOperations,
    retryOperations,
    retryReserveRemaining:
      QUEUE_FREE_TIER_BUDGET.reservedOperationsPerDay - retryOperations,
    operations,
    retriesPerDay,
    continuationsPerDay,
  };
}

const models = [
  estimate({
    label: "設計目標（全Queue合計）",
    wakesPerDay: QUEUE_FREE_TIER_BUDGET.maxNormalMessagesPerDay,
    retriesPerDay: 0,
    continuationsPerDay: 0,
  }),
  estimate({
    label: "通常traffic（1,400 wake + 600 continuation + 50 retries）",
    wakesPerDay: 1_400,
    continuationsPerDay: 600,
    retriesPerDay: 50,
  }),
  estimate({
    label: "大量インポート日（静的1000 + 通知500 + cont400）",
    wakesPerDay: 1_500,
    continuationsPerDay: 400,
    retriesPerDay: 100,
  }),
  estimate({
    label: "500通知バースト + 継続",
    wakesPerDay: 500,
    continuationsPerDay: 100,
    retriesPerDay: 20,
  }),
  estimate({
    label: "1,000 static target 日（1 wake/chunk + cont）",
    wakesPerDay: 200,
    continuationsPerDay: 800,
    retriesPerDay: 40,
  }),
  estimate({
    label: `最大${MAX_MUTATION_TARGETS}-target mutation + users_index GC continuation最大${MAX_USERS_INDEX_GC_CONTINUATIONS}回`,
    wakesPerDay: MAX_MUTATION_TARGETS,
    continuationsPerDay: MAX_USERS_INDEX_GC_CONTINUATIONS,
  }),
  estimate({
    label: "failure day（通常2,000 messages + 150件が各3 retries）",
    wakesPerDay: QUEUE_FREE_TIER_BUDGET.maxNormalMessagesPerDay,
    retriesPerDay: 150 * 3,
  }),
];

let failed = false;
console.log(
  JSON.stringify(
    {
      service: "estimate-queue-budget",
      budget: QUEUE_FREE_TIER_BUDGET,
      ops_per_normal_wake: OPS_PER_NORMAL_WAKE,
      models,
    },
    null,
    2,
  ),
);

for (const model of models) {
  try {
    assert.ok(
      model.messages <= QUEUE_FREE_TIER_BUDGET.maxNormalMessagesPerDay * 1.25,
      `${model.label}: messages ${model.messages} exceeds soft cap`,
    );
    assert.ok(
      model.normalOperations <= QUEUE_FREE_TIER_BUDGET.maxNormalOperationsPerDay,
      `${model.label}: normal operations ${model.normalOperations} exceed the normal budget`,
    );
    assert.ok(
      model.retryOperations <= QUEUE_FREE_TIER_BUDGET.reservedOperationsPerDay,
      `${model.label}: retry operations ${model.retryOperations} exceed the retry/DLQ reserve`,
    );
    assert.ok(
      model.operations <= MAX_BUSY_DAY_OPERATIONS,
      `${model.label}: operations ${model.operations} exceeds the internal busy-day target`,
    );
    if (model.retryOperations > 0) {
      console.warn(
        JSON.stringify({
          service: "estimate-queue-budget",
          result: "uses_retry_reserve",
          label: model.label,
          normalOperations: model.normalOperations,
          retryOperations: model.retryOperations,
          retryReserveRemaining: model.retryReserveRemaining,
          operations: model.operations,
        }),
      );
    }
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : error);
  }
}

const design = models[0];
assert.equal(design.operations, 6_000);
assert.equal(design.messages, 2_000);

if (failed) process.exit(1);
console.log("[estimate-queue-budget] OK");
