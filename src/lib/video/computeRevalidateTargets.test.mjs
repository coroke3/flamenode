import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeStaticRebuildFlags,
  computeVideoRevalidatePaths,
} from "./computeRevalidateTargets.ts";

test("computeVideoRevalidatePaths invalidates internal, old and new valid YouTube aliases", () => {
  const paths = computeVideoRevalidatePaths({
    videoId: "v1",
    previousYoutubeVideoId: "AAAAAAAAAAA",
    nextYoutubeVideoId: "BBBBBBBBBBB",
    primaryEventId: null,
    youtubeChanged: true,
  });
  assert.deepEqual(paths, ["/", "/list", "/dashboard", "/v1", "/AAAAAAAAAAA", "/BBBBBBBBBBB"]);
});

test("video edits invalidate both aliases even if the YouTube ID did not change", () => {
  const paths = computeVideoRevalidatePaths({
    videoId: "v1",
    previousYoutubeVideoId: "AAAAAAAAAAA",
    nextYoutubeVideoId: "AAAAAAAAAAA",
    primaryEventId: "event_1",
    youtubeChanged: false,
  });
  assert.deepEqual(paths, [
    "/", "/list", "/dashboard", "/v1", "/AAAAAAAAAAA",
    "/event/event_1", "/event/event_1/slots",
  ]);
});

test("video edits never derive cache paths from malformed legacy IDs", () => {
  for (const youtubeId of ["/outside.example", "//outside.example", "javascript:alert(1)", "abcdefghijkl"]) {
    const paths = computeVideoRevalidatePaths({
      videoId: "v1",
      previousYoutubeVideoId: youtubeId,
      nextYoutubeVideoId: "https://youtu.be/BBBBBBBBBBB?t=5",
      primaryEventId: null,
      youtubeChanged: true,
    });
    assert.deepEqual(paths, ["/", "/list", "/dashboard", "/v1", "/BBBBBBBBBBB"]);
  }
  const unchanged = computeVideoRevalidatePaths({
    videoId: "v1",
    previousYoutubeVideoId: "AAAAAAAAAAA",
    nextYoutubeVideoId: "BBBBBBBBBBB",
    primaryEventId: null,
    youtubeChanged: false,
  });
  assert.ok(!unchanged.includes("/BBBBBBBBBBB"), "unchanged YouTube alias should not be added");
});

test("computeStaticRebuildFlags marks creator aggregation only for a member X ID set change", () => {
  const flags = computeStaticRebuildFlags({
    canEditIdentity: false,
    allowSubmitterChange: false,
    displayNameChanged: false,
    iconChanged: false,
    canEditPrimaryEvent: false,
    hasEventIdsField: false,
    memberAggregationChanged: true,
  });
  assert.equal(flags.creatorAggregationChanged, true);
  assert.equal(flags.randomPoolCardChanged, false);
  assert.equal(flags.eventProjectionChanged, false);
});

test("member field-only edits do not mark creator aggregation or card fan-out", () => {
  const flags = computeStaticRebuildFlags({
    canEditIdentity: false,
    allowSubmitterChange: false,
    displayNameChanged: false,
    iconChanged: false,
    canEditPrimaryEvent: false,
    hasEventIdsField: false,
    memberAggregationChanged: false,
  });
  assert.equal(flags.creatorAggregationChanged, false);
  assert.equal(flags.randomPoolCardChanged, false);
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
