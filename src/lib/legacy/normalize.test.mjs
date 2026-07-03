import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeLegacyVideo } from "./normalize.ts";

test("normalizeLegacyVideo does not emit deprecated custom_answers fields", () => {
  const result = normalizeLegacyVideo({
    eventid: "event-a",
    title: "Title",
    tlink: "Creator",
    toudan: "Talk note",
    movieyear: "3 years",
  });

  assert.equal(result.ok, true);
  assert.equal("custom_answers" in result.video, false);
  assert.equal("declared_experience" in result.video, false);
  assert.ok(
    result.warnings.some((warning) => warning.includes("custom_answers")),
  );
});
