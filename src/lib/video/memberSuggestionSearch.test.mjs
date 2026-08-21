import assert from "node:assert/strict";
import { test } from "node:test";

import { searchMemberSuggestions } from "./memberSuggestionSearch.ts";

const items = [
  {
    x_user_id: "alice",
    name: "Alice",
    xAliases: [],
    nameAliases: [],
    occurrenceCount: 1,
    lastSeenAt: null,
    approvalStatus: "approved",
  },
  {
    x_user_id: "bob",
    name: "Bob",
    xAliases: [],
    nameAliases: [],
    occurrenceCount: 1,
    lastSeenAt: null,
    approvalStatus: "pending",
  },
  {
    x_user_id: "alice_animation",
    name: "Popular Alice",
    xAliases: [],
    nameAliases: [],
    occurrenceCount: 100,
    lastSeenAt: null,
    approvalStatus: "approved",
  },
];

test("候補検索はprefilter後もexact順位とページングを維持する", () => {
  const result = searchMemberSuggestions(items, {
    query: "alice",
    limit: 1,
    offset: 0,
    nowSec: 1_000,
  });

  assert.equal(result.items[0]?.x_user_id, "alice");
  assert.equal(result.items[0]?.matchedBy, "xid_exact");
  assert.equal(result.hasMore, true);
  assert.equal(result.nextOffset, 1);
});

test("onlyApprovedは順位付け前に候補を絞る", () => {
  const result = searchMemberSuggestions(items, {
    query: "bob",
    limit: 20,
    offset: 0,
    onlyApproved: true,
  });

  assert.deepEqual(result.items, []);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextOffset, null);
});

test("長さ窓で残した候補はrankerのfuzzy結果を失わない", () => {
  const result = searchMemberSuggestions(items, {
    query: "alise",
    limit: 20,
    offset: 0,
  });

  assert.equal(result.items[0]?.x_user_id, "alice");
  assert.equal(result.items[0]?.matchedBy, "fuzzy_1");
});
