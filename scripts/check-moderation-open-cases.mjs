#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const pending = readFileSync(
  path.join(root, "docs/database/pending/video-moderation-open-unique.sql"),
  "utf8",
);
assert.match(pending, /video_moderation_cases_open_unique_idx/);
assert.match(pending, /WHERE status = 'open'/);

const moderationAdmin = readFileSync(
  path.join(root, "src/lib/actions/moderation-admin.ts"),
  "utf8",
);
assert.match(moderationAdmin, /planVideoVisibilityTransition/);
assert.match(moderationAdmin, /buildAfterVideoStatusChangeQueueBatch|planVideoVisibilityTransition/);

const transition = readFileSync(
  path.join(root, "src/lib/video/videoVisibilityTransition.ts"),
  "utf8",
);
assert.match(transition, /buildAfterVideoStatusChangeQueueBatch/);
assert.match(transition, /buildVideoStatusChangeNotificationBatch/);
assert.match(transition, /preCommitVideoVisibilityDepublicization/);

const openCases = readFileSync(
  path.join(root, "src/lib/moderation/openCases.ts"),
  "utf8",
);
assert.match(openCases, /planVoidModerationCaseOpen/);
assert.match(openCases, /planVoidModerationCaseResolve/);

console.log("check:moderation-open-cases OK");
