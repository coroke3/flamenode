/**
 * Cloudflare Queues Free 枠の運用推計。
 * 正本定数: src/lib/queues/wakeBudget.ts
 *
 * Usage: node scripts/estimate-queue-budget.mjs
 */

import assert from "node:assert/strict";
import { QUEUE_FREE_TIER_BUDGET } from "../src/lib/queues/wakeBudget.ts";

/** 1 wake あたりの典型 operations（send + receive + ack） */
const OPS_PER_NORMAL_WAKE = 3;
/** retry 1回あたりの追加 ops 目安 */
const OPS_PER_RETRY = 2;

function estimate({
  label,
  wakesPerDay,
  retriesPerDay = 0,
  continuationsPerDay = 0,
}) {
  const messages = wakesPerDay + continuationsPerDay;
  const operations =
    messages * OPS_PER_NORMAL_WAKE + retriesPerDay * OPS_PER_RETRY;
  return { label, messages, operations, retriesPerDay, continuationsPerDay };
}

const models = [
  estimate({
    label: "設計目標（全Queue合計）",
    wakesPerDay: QUEUE_FREE_TIER_BUDGET.maxNormalMessagesPerDay,
    retriesPerDay: 0,
    continuationsPerDay: 0,
  }),
  estimate({
    label: "通常日モデル（通知400 + 静的800 + YouTube200 + cont600）",
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
      model.operations <=
        QUEUE_FREE_TIER_BUDGET.maxNormalOperationsPerDay +
          QUEUE_FREE_TIER_BUDGET.reservedOperationsPerDay,
      `${model.label}: operations ${model.operations} exceeds hard pool`,
    );
    if (model.operations > QUEUE_FREE_TIER_BUDGET.maxNormalOperationsPerDay) {
      console.warn(
        JSON.stringify({
          service: "estimate-queue-budget",
          result: "uses_reserved_ops",
          label: model.label,
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
