import assert from "node:assert/strict";
import { test } from "node:test";
import { projectLiveSlotIdentity } from "./liveApiCore.ts";

test("live slots expose identity only in public-name mode", () => {
  assert.deepEqual(
    projectLiveSlotIdentity("public_name", "public-video", "creator"),
    { video_id: "public-video", display_name: "creator" },
  );
  for (const mode of ["anonymous", "hidden", null]) {
    assert.deepEqual(projectLiveSlotIdentity(mode, "video", "creator"), {
      video_id: null,
      display_name: null,
    });
  }
});

test("private video identity is not reconstructed in public-name mode", () => {
  assert.deepEqual(projectLiveSlotIdentity("public_name", null, "creator"), {
    video_id: null,
    display_name: "creator",
  });
});
