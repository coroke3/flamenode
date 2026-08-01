import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const trackerSource = await readFile(
  new URL("./VideoViewTracker.tsx", import.meta.url),
  "utf8",
);

test("VideoViewTracker: no-op when GA measurement ID is unset", () => {
  assert.match(trackerSource, /NEXT_PUBLIC_GA_MEASUREMENT_ID/);
  assert.match(trackerSource, /if \(!GA_MEASUREMENT_ID\) return;/);
});

test("VideoViewTracker: sendGAEvent uses flamenode_video_view contract fields", () => {
  assert.match(trackerSource, /sendGAEvent\("event", "flamenode_video_view"/);
  assert.match(trackerSource, /watch_threshold_seconds:\s*VIEW_THRESHOLD_SECONDS/);
  assert.match(
    trackerSource,
    /primary_event_id:\s*primaryEventId\s*\?\?\s*"none"/,
  );
});
