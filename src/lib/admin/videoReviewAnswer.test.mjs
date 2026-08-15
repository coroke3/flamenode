import assert from "node:assert/strict";
import { test } from "node:test";
import { formatVideoReviewAnswer } from "./videoReviewAnswer.ts";

test("review answer prefers trimmed answer_text", () => {
  assert.equal(formatVideoReviewAnswer("  free text  ", '["checkbox"]'), "free text");
});

test("review answer renders checkbox answer_json values", () => {
  assert.equal(
    formatVideoReviewAnswer(null, '["first option", "second option"]'),
    "first option, second option",
  );
});

test("review answer treats empty JSON values as unanswered", () => {
  assert.equal(formatVideoReviewAnswer(null, "[]"), "");
  assert.equal(formatVideoReviewAnswer(null, "{}"), "");
  assert.equal(formatVideoReviewAnswer(null, "null"), "");
  assert.equal(formatVideoReviewAnswer(null, "  "), "");
});
