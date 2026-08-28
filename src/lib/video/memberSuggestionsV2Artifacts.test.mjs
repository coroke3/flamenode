import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMemberSuggestionsV2Artifacts,
  memberSuggestionQueryGrams,
  MEMBER_SUGGESTIONS_V2_MIN_GRAM_LENGTH,
} from "./memberSuggestionsPostingsV2.ts";

const ITEMS = [
  {
    x_user_id: "alice_mv",
    name: "Alice Movie",
    xAliases: ["alice_old"],
    nameAliases: ["ありす"],
    occurrenceCount: 3,
    lastSeenAt: 1_700_000_000,
    approvalStatus: "approved",
  },
  {
    x_user_id: "bob_motion",
    name: "Bob Motion",
    xAliases: [],
    nameAliases: ["ボブ"],
    occurrenceCount: 2,
    lastSeenAt: null,
    approvalStatus: "approved",
  },
];

test("member suggestions V2はAPIから到達不能な1文字postingを生成物へ残さない", () => {
  const artifacts = buildMemberSuggestionsV2Artifacts({
    items: ITEMS,
    generation: "test-generation",
    generatedAt: 1_800_000_000,
  });

  const records = artifacts.pages.flatMap(({ page }) => page.records);
  assert.ok(records.length > 0);
  assert.ok(
    records.every(
      (record) => [...record.gram].length >= MEMBER_SUGGESTIONS_V2_MIN_GRAM_LENGTH,
    ),
  );

  for (const { directory } of artifacts.directories) {
    assert.ok(
      Object.keys(directory.grams).every(
        (gram) => [...gram].length >= MEMBER_SUGGESTIONS_V2_MIN_GRAM_LENGTH,
      ),
    );
  }
});

test("2文字queryに必要なpostingはprune後も維持する", () => {
  const artifacts = buildMemberSuggestionsV2Artifacts({
    items: ITEMS,
    generation: "test-generation-2",
    generatedAt: 1_800_000_001,
  });
  const queryGrams = memberSuggestionQueryGrams("al");
  assert.deepEqual(queryGrams, ["al"]);

  const publishedGrams = new Set(
    artifacts.pages.flatMap(({ page }) => page.records.map((record) => record.gram)),
  );
  assert.ok(publishedGrams.has("al"));
});
