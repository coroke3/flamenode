#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY } from "../src/lib/publicData/publicVisibilityManifestCore.ts";

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
  assert.match(fencesSql, /FROM public_visibility_fences/);
  assert.match(fencesSql, /entity_type = 'video'/);
  assert.match(videosSql, /visibility_status = 'public'/);
});

test("public-visibility-fences script supports read-only remote inspection", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /--remote/);
  assert.match(source, /assertRemoteD1Configured/);
  assert.match(source, /wrangler r2 object get/);
  assert.match(source, /PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY/);
  assert.match(source, /public_video_r2_blocked/);
  assert.match(source, /d1_r2_fence_token_mismatch/);
  assert.match(source, /released_fence_still_in_manifest/);
  assert.match(source, /r2_block_unknown_or_nonpublic_video/);
  assert.doesNotMatch(source, /auto-release|auto_release/i);
  assert.match(source, /process\.exit\(2\)/);
});
