#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
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

console.log(
  `[check-artifact-slo] OK (${ARTIFACT_SLO_PROBES.length} global artifact probes)`,
);
