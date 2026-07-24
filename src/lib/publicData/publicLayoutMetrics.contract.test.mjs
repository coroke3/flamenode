/**
 * Public layout / metrics ALS contract.
 *
 * Usage: node --test src/lib/publicData/publicLayoutMetrics.contract.test.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layoutSource = await readFile(
  new URL("../../../app/(public)/layout.tsx", import.meta.url),
  "utf8",
);
const shellSource = await readFile(
  new URL("../../components/layout/PublicMetricsShell.tsx", import.meta.url),
  "utf8",
);
const bannerSource = await readFile(
  new URL("../../components/layout/PublicDegradedBanner.tsx", import.meta.url),
  "utf8",
);

test("PublicDegradedBanner は PublicMetricsShell 内で ALS スコープを共有する", () => {
  assert.doesNotMatch(layoutSource, /PublicDegradedBanner/);
  assert.match(shellSource, /runWithPublicRequestMetrics/);
  assert.match(shellSource, /PublicDegradedBanner/);
  assert.match(bannerSource, /role="status"/);
  assert.match(bannerSource, /public_data_mode !== "degraded_d1"/);
});
