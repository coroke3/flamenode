import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../../../app/(manage)/manage/events/[id]/videos/page.tsx", import.meta.url),
  "utf8",
);

test("manage video rows keep review columns while using the event-scoped summary batch", () => {
  assert.match(source, /const isReviewFilter = activeStatusGroup === ["']review["'];/);
  assert.match(
    source,
    /const summaries\s*=\s*baseRows\.length\s*>\s*0\s*\?\s*await fetchVideoReviewSummaries\(/,
  );
  assert.match(
    source,
    /fetchVideoReviewSummaries\(\s*db,\s*baseRows\.map\(\(row\) => row\.id\),\s*id,\s*\)/s,
  );
  assert.match(source, /:\s*new Map\(\);/);
  assert.match(source, /\.orderBy\(\.\.\.videoReviewQueueOrder\)/);
});
