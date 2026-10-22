#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  STATIC_ARTIFACT_REFRESH_AFTER_SEC,
} from "../workers/json-generator/r2Dedup.ts";
import { STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS } from "../workers/json-generator/staleArtifactRefresh.ts";
import {
  ARTIFACT_SLO_MAX_AGE_SEC,
  ARTIFACT_SLO_PROBES,
  listArtifactSloKeys,
} from "../src/lib/health/artifactSlo.ts";

const root = process.cwd();
const staticDeliveryDoc = readFileSync(
  path.join(root, "docs/operations/static-delivery.md"),
  "utf8",
);

const expectedKeys = [
  "top.json",
  "list/recent.json",
  "list/popular.json",
  "search-index-lite.json",
  "events/index.json",
  "users/index.json",
  "recommend/core.v1.json",
  "recommend.json",
  "rules/current.json",
  "youtube/related-blocklist.v1.json",
  "videos/random-pool.v1.json",
  "visibility/blocked-entities.v1.json",
];

const actualKeys = listArtifactSloKeys();
assert.deepEqual(actualKeys, expectedKeys);

for (const probe of ARTIFACT_SLO_PROBES) {
  assert.ok(probe.key.length > 0, "artifact probe key is required");
  assert.ok(probe.requiredKeys.length > 0, `${probe.key}: requiredKeys is empty`);
  assert.ok(
    probe.requiredKeys.includes("generated_at"),
    `${probe.key}: generated_at is required for SLO`,
  );
  if (probe.key === "visibility/blocked-entities.v1.json") {
    assert.equal(probe.allowMissing, true, "visibility manifest is bootstrap-ok");
  }
  assert.match(
    staticDeliveryDoc,
    new RegExp(probe.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${probe.key} must be documented in docs/operations/static-delivery.md`,
  );
}

// dedup は内容不変の artifact を再PUTしないため、REFRESH_AFTER を SLO の最大経過より
// 十分短く保たないと generated_at が SLO を割る（deep health 503）。
for (const [name, maxAge] of Object.entries(ARTIFACT_SLO_MAX_AGE_SEC)) {
  assert.ok(
    STATIC_ARTIFACT_REFRESH_AFTER_SEC + 14 * 24 * 3600 <= maxAge,
    `${name}: SLO max age must leave >= 14 days after STATIC_ARTIFACT_REFRESH_AFTER_SEC`,
  );
}

// sweep が HEAD する global key は SLO probe と一致させる（visibility manifest だけ除外）。
for (const probe of ARTIFACT_SLO_PROBES) {
  if (probe.key === "visibility/blocked-entities.v1.json") continue;
  assert.ok(
    STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS[probe.key],
    `${probe.key}: needs a rebuild target in STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS`,
  );
}
const rebuildSource = readFileSync(path.join(root, "workers/json-generator/rebuild.ts"), "utf8");
for (const target of Object.values(STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS)) {
  assert.ok(
    rebuildSource.includes(`case "${target}":`),
    `${target}: sweep target must be handled by rebuildTarget`,
  );
}
assert.equal(
  Object.keys(STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS).length,
  ARTIFACT_SLO_PROBES.length - 1,
  "STALE_ARTIFACT_REFRESH_GLOBAL_TARGETS must not contain keys outside the SLO probes",
);

console.log(
  `[check-artifact-slo] OK (${ARTIFACT_SLO_PROBES.length} global artifact probes)`,
);
