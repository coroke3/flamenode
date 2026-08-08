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

test("computeStaticRebuildFlags marks creator aggregation when members section touched", () => {
  const flags = computeStaticRebuildFlags({
    canEditIdentity: false,
    allowSubmitterChange: false,
    displayNameChanged: false,
    iconChanged: false,
    canEditPrimaryEvent: false,
    hasEventIdsField: false,
    membersSectionTouched: true,
  });
  assert.equal(flags.creatorAggregationChanged, true);
  assert.equal(flags.randomPoolCardChanged, true);
  assert.equal(flags.eventProjectionChanged, false);
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
  assert.equal(flags.eventProjectionChanged, true);
  assert.equal(flags.identityChanged, false);
  assert.equal(flags.randomPoolCardChanged, true);
});

test("title/youtube/part changes invalidate event projection", () => {
  const base = {
    canEditIdentity: false,
    allowSubmitterChange: false,
    displayNameChanged: false,
    iconChanged: false,
    canEditPrimaryEvent: false,
    hasEventIdsField: false,
  };
  for (const change of [
    { titleChanged: true },
    { youtubeChanged: true },
    { partChanged: true },
  ]) {
    const flags = computeStaticRebuildFlags({ ...base, ...change });
    assert.equal(flags.eventProjectionChanged, true);
    assert.equal(flags.randomPoolCardChanged, true);
  }
});

test("identity changes invalidate event projection", () => {
  const flags = computeStaticRebuildFlags({
    canEditIdentity: true,
    allowSubmitterChange: false,
    displayNameChanged: true,
    iconChanged: false,
    canEditPrimaryEvent: false,
    hasEventIdsField: false,
  });
  assert.equal(flags.identityChanged, true);
  assert.equal(flags.eventProjectionChanged, true);
});
