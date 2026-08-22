import assert from "node:assert/strict";
import { test } from "node:test";

const { validateVideoPublicEligibility } = await import(
  "./videoPublicEligibility.ts"
);

test("YouTube source without an ID can become public when its video info is available", () => {
  const result = validateVideoPublicEligibility(
    { source_type: "youtube", youtube_video_id: null },
    "public",
  );
  assert.deepEqual(result, { ok: true });
});
test("an attached YouTube ID and non-YouTube sources remain eligible", () => {
  assert.deepEqual(
    validateVideoPublicEligibility(
      { source_type: "youtube", youtube_video_id: "dQw4w9WgXcQ" },
      "public",
    ),
    { ok: true },
  );
  assert.deepEqual(
    validateVideoPublicEligibility(
      { source_type: "manual", youtube_video_id: null },
      "public",
    ),
    { ok: true },
  );
  assert.deepEqual(
    validateVideoPublicEligibility(
      { source_type: "youtube", youtube_video_id: null },
      "pending",
    ),
    { ok: true },
  );
});
