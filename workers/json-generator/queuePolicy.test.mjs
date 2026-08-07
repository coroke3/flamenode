import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  MAX_QUEUE_ITEMS_ECONOMY,
  MAX_QUEUE_ITEMS_PER_RUN,
  queueLimitForMode,
} from "./queuePolicy.ts";

const queuePolicySource = await readFile(
  new URL("./queuePolicy.ts", import.meta.url),
  "utf8",
);

test("normalも1回最大1件", () => {
  assert.equal(MAX_QUEUE_ITEMS_PER_RUN, 1);
  assert.equal(queueLimitForMode("normal"), 1);
});

test("economyは1回最大1件", () => {
  assert.equal(MAX_QUEUE_ITEMS_ECONOMY, 1);
  assert.equal(queueLimitForMode("economy"), 1);
});

test("全modeでFree CPU向け上限を超えない", () => {
  for (const mode of ["normal", "economy", "read_only", "static_only", "maintenance"]) {
    assert.ok(queueLimitForMode(mode) <= 1);
  }
});

test("read_only allowlist includes top/recommend producers and users_index composer", () => {
  const inList =
    queuePolicySource.match(
      /read_only[\s\S]*?target_type IN \(([\s\S]*?)\)/,
    )?.[1] ?? "";
  for (const targetType of [
    "recommend_core",
    "top_recommended",
    "top",
    "users_index",
    "event_base",
  ]) {
    assert.match(inList, new RegExp(`'${targetType}'`));
  }
});
