import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeStaticRebuildFlags,
  computeVideoRevalidatePaths,
} from "./computeRevalidateTargets.ts";

test("computeVideoRevalidatePaths includes old and new youtube paths when id changes", () => {
  const paths = computeVideoRevalidatePaths({
    videoId: "v1",
    previousYoutubeVideoId: "old123",
    nextYoutubeVideoId: "new456",
    primaryEventId: null,
    youtubeChanged: true,
  });
  assert.ok(paths.includes("/old123"));
  assert.ok(paths.includes("/new456"));
});

test("computeStaticRebuildFlags marks event membership changed only when field present", () => {
  const flags = computeStaticRebuildFlags({
    canEditIdentity: false,
    allowSubmitterChange: false,
    displayNameChanged: false,
    iconChanged: false,
    canEditPrimaryEvent: true,
    hasEventIdsField: true,
  });
  assert.equal(flags.eventMembershipChanged, true);
  assert.equal(flags.identityChanged, false);
  assert.equal(flags.randomPoolCardChanged, true);
});
