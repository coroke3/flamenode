#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY } from "../src/lib/publicData/publicVisibilityManifestCore.ts";
import { collectRemoteIssues } from "./check-public-visibility-fences.mjs";

const root = process.cwd();
const scriptPath = path.join(root, "scripts/check-public-visibility-fences.mjs");

test("public-visibility-fences SQL files query fences and public videos", () => {
  const fencesSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-public-visibility-fences-db.sql"),
    "utf8",
  );
  const videosSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-public-visibility-videos-public.sql"),
    "utf8",
  );
  const eventFencesSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-public-visibility-fences-events-db.sql"),
    "utf8",
  );
  const eventsSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-public-visibility-events-public.sql"),
    "utf8",
  );
  const xUserFencesSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-public-visibility-fences-x-users-db.sql"),
    "utf8",
  );
  const eventGroupFencesSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-public-visibility-fences-event-groups-db.sql"),
    "utf8",
  );
  const xUsersSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-public-visibility-x-users-public.sql"),
    "utf8",
  );
  const eventGroupsSql = fs.readFileSync(
    path.join(root, "scripts/sql/check-public-visibility-event-groups-public.sql"),
    "utf8",
  );
  assert.match(fencesSql, /FROM public_visibility_fences/);
  assert.match(fencesSql, /entity_type = 'video'/);
  assert.match(videosSql, /visibility_status = 'public'/);
  assert.match(eventFencesSql, /entity_type = 'event'/);
  assert.match(eventsSql, /FROM events/);
  assert.match(eventsSql, /visibility_status = 'public'/);
  assert.match(xUserFencesSql, /entity_type = 'x_user'/);
  assert.match(eventGroupFencesSql, /entity_type = 'event_group'/);
  assert.match(xUsersSql, /FROM x_users/);
  assert.match(eventGroupsSql, /FROM event_groups/);
});

test("public-visibility-fences script supports read-only remote inspection", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /--remote/);
  assert.match(source, /assertRemoteD1Configured/);
  assert.match(source, /"r2",\s*"object",\s*"get"/);
  assert.match(source, /resolveWranglerCli/);
  assert.match(source, /PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY/);
  assert.match(source, /public_video_r2_blocked/);
  assert.match(source, /public_event_r2_blocked/);
  assert.match(source, /release_pending_missing_r2_entry/);
  assert.match(source, /d1_r2_fence_token_mismatch/);
  assert.match(source, /released_fence_still_in_manifest/);
  assert.match(source, /r2_block_unknown_or_nonpublic_\$\{manifestEntry\.entity_type\}/);
  assert.doesNotMatch(source, /auto-release|auto_release/i);
  assert.match(source, /process\.exit\(2\)/);
  assert.match(source, /--strict/);
  assert.match(source, /manifest_missing/);
  assert.match(source, /strict inspection failed/);
  assert.match(source, /normalizePublicVisibilityBlockedEntitiesManifest/);
});

test("release_pending の一致 token は公開行でも正常な promotion window として扱う", () => {
  const issues = collectRemoteIssues({
    fenceRows: [
      {
        entity_type: "event",
        entity_id: "event-1",
        fence_token: "token-1",
        state: "release_pending",
      },
    ],
    publicVideoRows: [],
    publicEventRows: [{ id: "event-1", visibility_status: "public" }],
    manifest: {
      schema_version: 1,
      revision: 2,
      generated_at: 100,
      entities: [
        {
          entity_type: "event",
          entity_id: "event-1",
          fence_token: "token-1",
          blocked_at: 100,
        },
      ],
    },
  });
  assert.deepEqual(issues, []);
});

test("X ID fence checks compare D1, R2, and public rows case-insensitively", () => {
  const issues = collectRemoteIssues({
    fenceRows: [
      {
        entity_type: "x_user",
        entity_id: "CreatorName",
        fence_token: "token-1",
        state: "release_pending",
      },
    ],
    publicVideoRows: [],
    publicEventRows: [],
    publicXUserRows: [{ id: "creatorname", approval_status: "approved" }],
    manifest: {
      schema_version: 1,
      revision: 5,
      generated_at: 100,
      entities: [
        {
          entity_type: "x_user",
          entity_id: "CREATORNAME",
          fence_token: "token-1",
          blocked_at: 100,
        },
      ],
    },
  });
  assert.deepEqual(issues, []);
});

test("event fence の token mismatch と pending manifest 欠落を検出する", () => {
  const issues = collectRemoteIssues({
    fenceRows: [
      {
        entity_type: "event",
        entity_id: "event-mismatch",
        fence_token: "d1-token",
        state: "blocked",
        blocked_at: Math.floor(Date.now() / 1000),
      },
      {
        entity_type: "event",
        entity_id: "event-missing",
        fence_token: "pending-token",
        state: "release_pending",
      },
    ],
    publicVideoRows: [],
    publicEventRows: [],
    manifest: {
      schema_version: 1,
      revision: 3,
      generated_at: 100,
      entities: [
        {
          entity_type: "event",
          entity_id: "event-mismatch",
          fence_token: "r2-token",
          blocked_at: 100,
        },
      ],
    },
  });
  assert.ok(issues.some((issue) => issue.kind === "d1_r2_fence_token_mismatch"));
  assert.ok(issues.some((issue) => issue.kind === "release_pending_missing_r2_entry"));
});

test("event ID rename tombstone はイベント行がなくても異常扱いにしない", () => {
  const issues = collectRemoteIssues({
    fenceRows: [
      {
        entity_type: "event",
        entity_id: "old-event",
        fence_token: "tombstone",
        state: "blocked",
        reason: "event_id_rename_old_cleanup",
        blocked_at: Math.floor(Date.now() / 1000),
      },
    ],
    publicVideoRows: [],
    publicEventRows: [],
    manifest: {
      schema_version: 1,
      revision: 4,
      generated_at: 100,
      entities: [
        {
          entity_type: "event",
          entity_id: "old-event",
          fence_token: "tombstone",
          blocked_at: 100,
        },
      ],
    },
  });
  assert.deepEqual(issues, []);
});
