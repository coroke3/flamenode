#!/usr/bin/env node

import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const actionRoots = [
  path.join(root, "src/lib/actions"),
  path.join(root, "src/lib/admin/spreadsheet"),
  path.join(root, "src/lib/video"),
];

const violations = [];

// A symlink anywhere in a scan root can hide mutations or redirect the audit outside this checkout.
function rejectSymlinkAncestors(target) {
  let current = path.resolve(target);
  const repositoryRoot = path.resolve(root);
  while (true) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`[check:static-rebuild-atomicity] symlink in scan path: ${path.relative(root, current)}`);
    }
    if (current === repositoryRoot || current === path.dirname(current)) break;
    current = path.dirname(current);
  }
}

function collectTsFiles(dir) {
  rejectSymlinkAncestors(dir);
  const entries = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`[check:static-rebuild-atomicity] symlink in scan tree: ${path.relative(root, full)}`);
    }
    if (entry.isDirectory()) {
      entries.push(...collectTsFiles(full));
    } else if (
      entry.isFile() &&
      /\.(?:ts|tsx|mts)$/.test(entry.name) &&
      !/(?:\.test|\.spec|\.d)\.(?:ts|tsx|mts)$/.test(entry.name)
    ) {
      entries.push(full);
    }
  }
  return entries;
}

for (const dir of actionRoots) {
  for (const file of collectTsFiles(dir)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("visibility_status")) continue;
    if (
      source.includes("enqueueStaticRebuild(") &&
      source.includes("mutateWithAudit")
    ) {
      violations.push(`${file}: mutateWithAudit 後に enqueueStaticRebuild を直接呼んでいる`);
    }
    if (
      source.includes("visibility_status") &&
      source.includes("buildStaticRebuildQueueBatch") &&
      !source.includes("buildVideo") &&
      !source.includes("fan-out") &&
      !source.includes("FanOut") &&
      file.includes("moderation")
    ) {
      // moderation files are checked separately by Agent D
    }
  }
}

const enqueueSource = readFileSync(
  path.join(root, "packages/server-core/src/staticRebuild/enqueue.ts"),
  "utf8",
);
const batchStart = enqueueSource.indexOf(
  "export async function buildStaticRebuildQueueBatch",
);
const batchEnd = enqueueSource.indexOf(
  "export async function enqueueStaticRebuild(",
  batchStart,
);
assert.ok(batchStart >= 0, "static rebuild batch builder is missing");
assert.ok(batchEnd > batchStart, "static rebuild enqueue boundary is missing");
const batchBuilderSource = enqueueSource.slice(
  batchStart,
  batchEnd,
);
assert.match(batchBuilderSource, /FROM json_each\(\$\{payload\}\)/);
assert.match(
  batchBuilderSource,
  /ON CONFLICT\(target_type, target_id\) WHERE status IN \('pending', 'processing'\)/,
);
assert.doesNotMatch(batchBuilderSource, /shouldSkipRecentRow/);
assert.doesNotMatch(batchBuilderSource, /\.select\(staticRebuildActiveLookupSelect\)/);

const loaderSource = readFileSync(
  path.join(root, "src/lib/publicData/loader.ts"),
  "utf8",
);
assert.match(loaderSource, /directEnqueueStaticRebuild/);
assert.match(loaderSource, /probePublicStaticTarget/);
assert.match(loaderSource, /enqueued =[\s\S]*enqueueResult\.action === "inserted"/);

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("check:static-rebuild-atomicity OK");
