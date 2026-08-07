import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const orderSource = await readFile(
  new URL("./videoReviewQueueOrder.ts", import.meta.url),
  "utf8",
);

test("videoReviewQueueOrder uses created_at DESC then id DESC", () => {
  assert.match(orderSource, /desc\(videos\.created_at\)/);
  assert.match(orderSource, /desc\(videos\.id\)/);
  assert.match(orderSource, /videoReviewQueueOrder/);
});

test("resolveApproveAndNextHref falls back to review queue list", () => {
  assert.match(orderSource, /adminReviewQueueFallbackHref/);
  assert.match(orderSource, /\/admin\/videos\?status=review/);
  assert.match(orderSource, /adminEventFilter/);
  assert.match(orderSource, /manageReviewQueueFallbackHref/);
  assert.match(orderSource, /\/videos\?status=review/);
});

test("buildReviewDetailHref scopes manage paths by event and admin filter by query", () => {
  assert.match(orderSource, /\/admin\/videos\/\$\{videoId\}/);
  assert.match(orderSource, /\/manage\/events\/\$\{scope\.eventId\}\/videos\/\$\{videoId\}/);
  assert.match(orderSource, /adminEventFilter/);
  assert.match(orderSource, /\?event=/);
});

test("findNextPendingReviewVideoId queries pending items after current cursor", () => {
  assert.match(orderSource, /eq\(videos\.visibility_status, "pending"\)/);
  assert.match(orderSource, /lt\(videos\.created_at, current\.created_at\)/);
});

test("attachApproveAndNextHref is exported for same-status approve-and-next", () => {
  assert.match(orderSource, /export async function attachApproveAndNextHref/);
  assert.match(orderSource, /nextHref: resolveApproveAndNextHref/);
});
