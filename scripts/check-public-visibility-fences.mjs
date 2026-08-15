#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  normalizePublicVisibilityBlockedEntitiesManifest,
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
} from "../src/lib/publicData/publicVisibilityManifestCore.ts";
import {
  assertRemoteD1Configured,
  formatCommandFailure,
  resolveWranglerCli,
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
const eventFencesSqlPath = path.join(
  root,
  "scripts/sql/check-public-visibility-fences-events-db.sql",
);
const publicVideosSqlPath = path.join(
  root,
  "scripts/sql/check-public-visibility-videos-public.sql",
);
const publicEventsSqlPath = path.join(
  root,
  "scripts/sql/check-public-visibility-events-public.sql",
);
const xUserFencesSqlPath = path.join(
  root,
  "scripts/sql/check-public-visibility-fences-x-users-db.sql",
);
const eventGroupFencesSqlPath = path.join(
  root,
  "scripts/sql/check-public-visibility-fences-event-groups-db.sql",
);
const publicXUsersSqlPath = path.join(
  root,
  "scripts/sql/check-public-visibility-x-users-public.sql",
);
const publicEventGroupsSqlPath = path.join(
  root,
  "scripts/sql/check-public-visibility-event-groups-public.sql",
);

function fetchRemoteManifest(strict = false) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-r2-"));
  const tempFile = path.join(tempDir, "manifest.json");
  const objectPath = `${R2_BUCKET}/${PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY}`;
  try {
    execFileSync(
      process.execPath,
      [
        resolveWranglerCli(root),
        "r2",
        "object",
        "get",
        objectPath,
        "--remote",
        `--file=${tempFile}`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const text = fs.readFileSync(tempFile, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.entities)) {
      throw new Error("R2 manifest is malformed or missing entities array.");
    }
    if (strict && !normalizePublicVisibilityBlockedEntitiesManifest(parsed)) {
      throw new Error("R2 manifest is malformed in strict mode.");
    }
    return parsed;
  } catch (error) {
    const message = formatCommandFailure(error);
    if (/not found|does not exist|404/i.test(message)) {
      return {
        schema_version: 1,
        revision: 0,
        generated_at: 0,
        entities: [],
        // Keep the non-schema marker internal so strict mode can distinguish
        // a bootstrap gap from a valid empty manifest.
        __missing: true,
      };
    }
    throw new Error(`R2 manifest fetch failed: ${message}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function collectRemoteIssues({
  fenceRows,
  publicVideoRows,
  publicEventRows,
  publicXUserRows = [],
  publicEventGroupRows = [],
  manifest,
}) {
  const issues = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const publicRowsByType = new Map([
    ["video", publicVideoRows],
    ["event", publicEventRows],
    ["x_user", publicXUserRows],
    ["event_group", publicEventGroupRows],
  ]);
  const normalizeEntityId = (entityType, entityId) =>
    entityType === "x_user"
      ? String(entityId ?? "").trim().toLowerCase()
      : String(entityId ?? "").trim();
  const entityKey = (entityType, entityId) =>
    `${entityType}:${normalizeEntityId(entityType, entityId)}`;
  const idFieldByType = {
    video: "video_id",
    event: "event_id",
    x_user: "x_user_id",
    event_group: "event_group_id",
  };
  const fenceByEntityKey = new Map(
    fenceRows.map((row) => [entityKey(row.entity_type, row.entity_id), row]),
  );
  const manifestEntries = manifest.entities.filter(
    (entry) =>
      entry.entity_type === "video" ||
      entry.entity_type === "event" ||
      entry.entity_type === "x_user" ||
      entry.entity_type === "event_group",
  );
  const manifestByEntityKey = new Map(
    manifestEntries.map((entry) => [
      entityKey(entry.entity_type, entry.entity_id),
      entry,
    ]),
  );

  for (const [entityType, rows] of publicRowsByType) {
    for (const row of rows) {
      const entityId = row.id;
      const manifestEntry = manifestByEntityKey.get(
        entityKey(entityType, entityId),
      );
      const fence = fenceByEntityKey.get(entityKey(entityType, entityId));
      // A promotion intentionally keeps the R2 block while the composed
      // artifact is rebuilt. Do not report that expected release_pending
      // window as a leak; token mismatch or any other state remains an issue.
      if (
        manifestEntry &&
        !(
          fence?.state === "release_pending" &&
          fence.fence_token === manifestEntry.fence_token
        )
      ) {
        const kindByType = {
          video: "public_video_r2_blocked",
          event: "public_event_r2_blocked",
          x_user: "public_x_user_r2_blocked",
          event_group: "public_event_group_r2_blocked",
        };
        issues.push({
          kind: kindByType[entityType],
          ...({
            video: { video_id: entityId },
            event: { event_id: entityId },
            x_user: { x_user_id: entityId },
            event_group: { event_group_id: entityId },
          }[entityType]),
          fence_token: manifestEntry.fence_token,
        });
      }
    }
  }

  for (const fence of fenceRows) {
    const key = entityKey(fence.entity_type, fence.entity_id);
    const manifestEntry = manifestByEntityKey.get(key);
    const idField = idFieldByType[fence.entity_type];
    const idValue = fence.entity_id;
    if (fence.state === "blocked") {
      if (!manifestEntry) {
        issues.push({
          kind: "d1_blocked_missing_r2_entry",
          [idField]: idValue,
          fence_token: fence.fence_token,
        });
      } else if (manifestEntry.fence_token !== fence.fence_token) {
        issues.push({
          kind: "d1_r2_fence_token_mismatch",
          [idField]: idValue,
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
          [idField]: idValue,
          blocked_at: fence.blocked_at,
          age_sec: nowSec - fence.blocked_at,
        });
      }
    }

    if (fence.state === "release_pending" && !manifestEntry) {
      issues.push({
        kind: "release_pending_missing_r2_entry",
        [idField]: idValue,
        fence_token: fence.fence_token,
      });
    }

    if (fence.state === "released" && manifestEntry) {
      issues.push({
        kind: "released_fence_still_in_manifest",
        [idField]: idValue,
        d1_state: fence.state,
        r2_fence_token: manifestEntry.fence_token,
      });
    }
  }

  for (const manifestEntry of manifestEntries) {
    const key = entityKey(manifestEntry.entity_type, manifestEntry.entity_id);
    const fence = fenceByEntityKey.get(key);
    const idField = idFieldByType[manifestEntry.entity_type];
    if (!fence) {
      issues.push({
        kind: "r2_block_missing_d1_fence",
        [idField]: manifestEntry.entity_id,
        fence_token: manifestEntry.fence_token,
      });
      continue;
    }
    const entityRows = publicRowsByType.get(manifestEntry.entity_type) ?? [];
    const entityRow = entityRows.find(
      (row) =>
        normalizeEntityId(manifestEntry.entity_type, row.id) ===
        normalizeEntityId(manifestEntry.entity_type, manifestEntry.entity_id),
    );
    const isRenameTombstone =
      manifestEntry.entity_type === "event" &&
      fence.reason === "event_id_rename_old_cleanup";
    if (!entityRow && !isRenameTombstone) {
      issues.push({
        kind: `r2_block_unknown_or_nonpublic_${manifestEntry.entity_type}`,
        [idField]: manifestEntry.entity_id,
        fence_token: manifestEntry.fence_token,
      });
    }
  }

  return issues;
}

function printRemoteIssues(issues, strict = false) {
  console.log(`[check:public-visibility-fences] count=${issues.length}`);
  if (issues.length === 0) {
    console.log("check:public-visibility-fences OK (remote inspection)");
    return 0;
  }
  for (const issue of issues) {
    console.error(JSON.stringify(issue));
  }
  if (strict) {
    console.error(
      "[check:public-visibility-fences] strict inspection failed.",
    );
    return 1;
  }
  console.log("[check:public-visibility-fences] informational only.");
  return 0;
}

function runRemoteInspection(strict = false) {
  assertRemoteD1Configured("check:public-visibility-fences");
  const fenceRows = runRemoteD1File(fencesSqlPath, {
    scriptName: "check:public-visibility-fences",
  });
  const eventFenceRows = runRemoteD1File(eventFencesSqlPath, {
    scriptName: "check:public-visibility-fences",
  });
  const xUserFenceRows = runRemoteD1File(xUserFencesSqlPath, {
    scriptName: "check:public-visibility-fences",
  });
  const eventGroupFenceRows = runRemoteD1File(eventGroupFencesSqlPath, {
    scriptName: "check:public-visibility-fences",
  });
  const publicVideoRows = runRemoteD1File(publicVideosSqlPath, {
    scriptName: "check:public-visibility-fences",
  });
  const publicEventRows = runRemoteD1File(publicEventsSqlPath, {
    scriptName: "check:public-visibility-fences",
  });
  const publicXUserRows = runRemoteD1File(publicXUsersSqlPath, {
    scriptName: "check:public-visibility-fences",
  });
  const publicEventGroupRows = runRemoteD1File(publicEventGroupsSqlPath, {
    scriptName: "check:public-visibility-fences",
  });
  const manifest = fetchRemoteManifest(strict);
  const issues = collectRemoteIssues({
    fenceRows: [
      ...fenceRows,
      ...eventFenceRows,
      ...xUserFenceRows,
      ...eventGroupFenceRows,
    ],
    publicVideoRows,
    publicEventRows,
    publicXUserRows,
    publicEventGroupRows,
    manifest,
  });
  if (strict && manifest.__missing) {
    issues.unshift({ kind: "manifest_missing" });
  }
  process.exit(printRemoteIssues(issues, strict));
}

function main() {
  if (process.argv.includes("--remote")) {
    try {
      runRemoteInspection(process.argv.includes("--strict"));
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
