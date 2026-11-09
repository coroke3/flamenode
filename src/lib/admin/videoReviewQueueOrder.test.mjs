import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const orderSource = await readFile(
  new URL("./videoReviewQueueOrder.ts", import.meta.url),
  "utf8",
);
const coreSource = await readFile(
  new URL("../../../packages/server-core/src/video/reviewQueueOrder.ts", import.meta.url),
  "utf8",
);

test("videoReviewQueueOrder uses created_at DESC then id DESC", () => {
  assert.match(coreSource, /desc\(videos\.created_at\)/);
  assert.match(coreSource, /desc\(videos\.id\)/);
  assert.match(coreSource, /videoReviewQueueOrder/);
});

test("resolveApproveAndNextHref falls back to review queue list", () => {
  assert.match(coreSource, /adminReviewQueueFallbackHref/);
  assert.match(coreSource, /\/admin\/videos\?status=review/);
  assert.match(coreSource, /adminEventFilter/);
  assert.match(coreSource, /manageReviewQueueFallbackHref/);
  assert.match(coreSource, /\/videos\?status=review/);
});

test("buildReviewDetailHref scopes manage paths by event and admin filter by query", () => {
  assert.match(coreSource, /\/admin\/videos\/\$\{videoId\}/);
  assert.match(
    orderSource,
    /\/manage\/events\/\$\{encodeURIComponent\(scope\.eventId\)\}\/videos\/\$\{videoId\}/,
  );
  assert.match(coreSource, /adminEventFilter/);
  assert.match(coreSource, /\?event=/);
});

test("findNextPendingReviewVideoId queries pending items after current cursor", () => {
  assert.match(coreSource, /eq\(videos\.visibility_status, "pending"\)/);
  assert.match(coreSource, /lt\(videos\.created_at, current\.created_at\)/);
});

test("attachApproveAndNextHref is exported for same-status approve-and-next", () => {
  assert.match(coreSource, /export async function attachApproveAndNextHref/);
  assert.match(coreSource, /nextHref: resolveApproveAndNextHref/);
});
