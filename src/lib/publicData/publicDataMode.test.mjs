/**
 * PublicDataMode / degraded policy / loader contract tests.
 *
 * Usage: node --test src/lib/publicData/publicDataMode.test.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isDegradedD1Mode,
  isPublicDataUnavailable,
  mergePublicDataMode,
  toPublicJsonLegacySource,
} from "./publicDataMode.ts";
import {
  buildDegradedUsersPageSql,
  DEGRADED_USERS_PAGE_SIZE,
} from "./degradedUsersPageSql.ts";

const loaderSource = await readFile(new URL("./loader.ts", import.meta.url), "utf8");
const degradedPolicySource = await readFile(
  new URL("./degradedPolicy.ts", import.meta.url),
  "utf8",
);

test("PublicDataMode legacy source mapping", () => {
  assert.equal(toPublicJsonLegacySource("static"), "static");
  assert.equal(toPublicJsonLegacySource("cached_static"), "static");
  assert.equal(toPublicJsonLegacySource("degraded_d1"), "miss");
  assert.equal(toPublicJsonLegacySource("unavailable"), "miss");
});

test("mergePublicDataMode keeps the strongest mode", () => {
  assert.equal(mergePublicDataMode("static", "cached_static"), "cached_static");
  assert.equal(mergePublicDataMode("cached_static", "degraded_d1"), "degraded_d1");
  assert.equal(mergePublicDataMode("degraded_d1", "unavailable"), "degraded_d1");
});

test("isDegradedD1Mode / isPublicDataUnavailable", () => {
  assert.equal(isDegradedD1Mode("degraded_d1"), true);
  assert.equal(isDegradedD1Mode("static"), false);
  assert.equal(isPublicDataUnavailable("unavailable"), true);
  assert.equal(isPublicDataUnavailable("degraded_d1"), false);
});

test("kill switch: PUBLIC_DEGRADED_D1_ENABLED=0 disables degraded D1", () => {
  assert.match(degradedPolicySource, /PUBLIC_DEGRADED_D1_ENABLED/);
  assert.match(degradedPolicySource, /normalized === "0"/);
  assert.match(degradedPolicySource, /canAttemptDegradedD1/);
});

test("degraded D1 circuit breaker blocks fallback when KV reports open", () => {
  assert.match(loaderSource, /isDegradedD1CircuitOpen/);
  assert.match(loaderSource, /recordDegradedCircuitR2MissBestEffort/);
  assert.match(loaderSource, /recordDegradedCircuitR2HitBestEffort/);
  assert.doesNotMatch(loaderSource, /void\s+recordDegradedCircuitR2(?:Miss|Hit)\(/);
});

test("degraded users SQL has no correlated subquery and LIMIT 48", () => {
  const sql = buildDegradedUsersPageSql();
  assert.match(sql, /LIMIT \? OFFSET \?/);
  assert.doesNotMatch(sql, /SELECT COUNT\(/i);
  assert.doesNotMatch(sql, /WHERE[\s\S]*SELECT[\s\S]*FROM videos AS v[\s\S]*WHERE v\.creator_x_user_id =/i);
  assert.equal(DEGRADED_USERS_PAGE_SIZE, 48);
});

test("loader uses Cache API before R2 and degraded fetcher hook", () => {
  assert.match(loaderSource, /readPublicJsonCache/);
  assert.match(loaderSource, /readStaticJson/);
  const loadPublicJsonFn = loaderSource.slice(
    loaderSource.indexOf("export async function loadPublicJson"),
    loaderSource.indexOf("export async function loadStaticEventDetail"),
  );
  const cacheIndex = loadPublicJsonFn.indexOf("readPublicJsonCache");
  const r2Index = loadPublicJsonFn.indexOf("readStaticJson");
  assert.ok(cacheIndex >= 0 && r2Index > cacheIndex);
  assert.match(loaderSource, /degradedFetcher/);
  assert.match(loaderSource, /mode: "degraded_d1"/);
  assert.match(loaderSource, /mode: "unavailable"/);
  assert.match(loaderSource, /writePublicJsonCacheBestEffort/);
});
