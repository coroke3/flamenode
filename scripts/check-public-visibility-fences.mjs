#!/usr/bin/env node

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY } from "../src/lib/publicData/publicVisibilityManifestCore.ts";
import {
  assertRemoteD1Configured,
  formatCommandFailure,
  runRemoteD1File,
} from "./remote-d1-utils.mjs";

const root = process.cwd();
const R2_BUCKET = "flamenode-storage";
const LONG_LIVED_BLOCK_SEC = 7 * 24 * 60 * 60;

const migration = fs.readFileSync(
  path.join(root, "migrations/0049_public_visibility_fences.sql"),
  "utf8",
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public_visibility_fences/);
assert.match(migration, /entity_type/);
assert.match(migration, /fence_token/);
assert.match(migration, /requirements_json/);

const schema = fs.readFileSync(
  path.join(root, "src/lib/db/schema.ts"),
  "utf8",
);
assert.match(schema, /publicVisibilityFences/);

const manifestCore = fs.readFileSync(
  path.join(root, "src/lib/publicData/publicVisibilityManifestCore.ts"),
  "utf8",
);
assert.match(manifestCore, /visibility\/blocked-entities\.v1\.json/);
assert.match(manifestCore, /PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES/);

const manifest = fs.readFileSync(
  path.join(root, "src/lib/publicData/publicVisibilityManifest.ts"),
  "utf8",
);
assert.match(manifest, /MANIFEST_PUT_MAX_RETRIES = 3/);
assert.match(manifest, /cacheControl: "no-store"/);
assert.match(manifest, /resolvePublicVisibilityGuardModeFromEnv/);

const transition = fs.readFileSync(
  path.join(root, "src/lib/video/videoVisibilityTransition.ts"),
  "utf8",
);
assert.match(transition, /preCommitVideoVisibilityDepublicization/);
assert.match(transition, /compensateDepublicizationFenceOnD1Failure/);
assert.match(transition, /enqueueVideoVisibilityNotificationsPostCommit/);
assert.match(transition, /r2_token_mismatch/);
assert.match(transition, /stuck_fence_candidate/);
assert.doesNotMatch(
  transition,
  /mutationStatements\.push\(\s*\.\.\.notificationBatch\.statements/,
);

const fencesSqlPath = path.join(
  root,
  "scripts/sql/check-public-visibility-fences-db.sql",
);
const publicVideosSqlPath = path.join(
  root,
  "scripts/sql/check-public-visibility-videos-public.sql",
);

function fetchRemoteManifest() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-r2-"));
  const tempFile = path.join(tempDir, "manifest.json");
  try {
    execSync(
      `npx wrangler r2 object get ${R2_BUCKET} ${PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY} --remote --file=${tempFile}`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const text = fs.readFileSync(tempFile, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.entities)) {
      throw new Error("R2 manifest is malformed or missing entities array.");
    }
    return parsed;
  } catch (error) {
    const message = formatCommandFailure(error);
    if (/not found|does not exist|404/i.test(message)) {
      return { schema_version: 1, revision: 0, generated_at: 0, entities: [] };
    }
    throw new Error(`R2 manifest fetch failed: ${message}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function collectRemoteIssues({ fenceRows, publicVideoRows, manifest }) {
  const issues = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const publicVideoIds = new Set(publicVideoRows.map((row) => row.id));
  const fenceByVideoId = new Map(
    fenceRows.map((row) => [row.entity_id, row]),
  );
  const manifestVideoEntries = manifest.entities.filter(
    (entry) => entry.entity_type === "video",
  );
  const manifestByVideoId = new Map(
    manifestVideoEntries.map((entry) => [entry.entity_id, entry]),
  );

  for (const videoId of publicVideoIds) {
    const manifestEntry = manifestByVideoId.get(videoId);
    if (manifestEntry) {
      issues.push({
        kind: "public_video_r2_blocked",
        video_id: videoId,
        fence_token: manifestEntry.fence_token,
      });
    }
  }

  for (const fence of fenceRows) {
    const manifestEntry = manifestByVideoId.get(fence.entity_id);
    if (fence.state === "blocked") {
      if (!manifestEntry) {
        issues.push({
          kind: "d1_blocked_missing_r2_entry",
          video_id: fence.entity_id,
          fence_token: fence.fence_token,
        });
      } else if (manifestEntry.fence_token !== fence.fence_token) {
        issues.push({
          kind: "d1_r2_fence_token_mismatch",
          video_id: fence.entity_id,
          d1_fence_token: fence.fence_token,
          r2_fence_token: manifestEntry.fence_token,
        });
      }
      if (
        typeof fence.blocked_at === "number" &&
        nowSec - fence.blocked_at > LONG_LIVED_BLOCK_SEC
      ) {
        issues.push({
          kind: "long_lived_blocked_fence",
          video_id: fence.entity_id,
          blocked_at: fence.blocked_at,
          age_sec: nowSec - fence.blocked_at,
        });
      }
    }

    if (
      (fence.state === "released" || fence.state === "release_pending") &&
      manifestEntry
    ) {
      issues.push({
        kind: "released_fence_still_in_manifest",
        video_id: fence.entity_id,
        d1_state: fence.state,
        r2_fence_token: manifestEntry.fence_token,
      });
    }
  }

  for (const manifestEntry of manifestVideoEntries) {
    if (!fenceByVideoId.has(manifestEntry.entity_id)) {
      issues.push({
        kind: "r2_block_missing_d1_fence",
        video_id: manifestEntry.entity_id,
        fence_token: manifestEntry.fence_token,
      });
      continue;
    }
    const videoRow = publicVideoRows.find(
      (row) => row.id === manifestEntry.entity_id,
    );
    if (!videoRow) {
      issues.push({
        kind: "r2_block_unknown_or_nonpublic_video",
        video_id: manifestEntry.entity_id,
        fence_token: manifestEntry.fence_token,
      });
    }
  }

  return issues;
}

function printRemoteIssues(issues) {
  console.log(`[check:public-visibility-fences] count=${issues.length}`);
  if (issues.length === 0) {
    console.log("check:public-visibility-fences OK (remote inspection)");
    return 0;
  }
  for (const issue of issues) {
    console.error(JSON.stringify(issue));
  }
  console.log("[check:public-visibility-fences] informational only.");
  return 0;
}

function runRemoteInspection() {
  assertRemoteD1Configured("check:public-visibility-fences");
  const fenceRows = runRemoteD1File(fencesSqlPath, {
    scriptName: "check:public-visibility-fences",
  });
  const publicVideoRows = runRemoteD1File(publicVideosSqlPath, {
    scriptName: "check:public-visibility-fences",
  });
  const manifest = fetchRemoteManifest();
  const issues = collectRemoteIssues({ fenceRows, publicVideoRows, manifest });
  process.exit(printRemoteIssues(issues));
}

function main() {
  if (process.argv.includes("--remote")) {
    try {
      runRemoteInspection();
    } catch (error) {
      console.error(
        `[check:public-visibility-fences] remote inspection failed: ${formatCommandFailure(error)}`,
      );
      process.exit(2);
    }
    return;
  }

  console.log("check:public-visibility-fences OK");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
