import assert from "node:assert/strict";
import { test } from "node:test";

const { canAttachInitialYoutubeToSlottedVideo } = await import(
  "./youtubeAttachEligibility.ts"
);

const base = {
  sourceType: "youtube",
  schedulingType: "slotted",
  visibilityStatus: "pending",
  youtubeVideoId: null,
  privilegeMode: "normal",
  isCreatorOwner: true,
};

test("creator can attach the first YouTube ID to a pending slotted video", () => {
  assert.equal(canAttachInitialYoutubeToSlottedVideo(base), true);
});
test("creator can attach the first YouTube ID after publishing the info-only page", () => {
  assert.equal(
    canAttachInitialYoutubeToSlottedVideo({ ...base, visibilityStatus: "public" }),
    true,
  );
});
test("the exception does not become general YouTube edit permission", () => {
  assert.equal(
    canAttachInitialYoutubeToSlottedVideo({ ...base, youtubeVideoId: "old-id" }),
    false,
  );
  assert.equal(
    canAttachInitialYoutubeToSlottedVideo({ ...base, isCreatorOwner: false }),
    false,
  );
  assert.equal(
    canAttachInitialYoutubeToSlottedVideo({ ...base, privilegeMode: "event" }),
    false,
  );
  assert.equal(
    canAttachInitialYoutubeToSlottedVideo({ ...base, sourceType: "manual" }),
    false,
  );
});
