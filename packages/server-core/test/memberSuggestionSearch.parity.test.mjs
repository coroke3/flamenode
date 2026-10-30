import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeMemberSearchText as currentNormalize,
  prefilterMemberSuggestionCandidates as currentPrefilter,
  rankMemberSuggestionCandidates as currentRank,
} from "../../../src/lib/video/memberSuggestionRank.ts";
import { searchMemberSuggestions as currentSearch } from "../../../src/lib/video/memberSuggestionSearch.ts";
import {
  normalizeMemberSearchText as coreNormalize,
  prefilterMemberSuggestionCandidates as corePrefilter,
  rankMemberSuggestionCandidates as coreRank,
} from "../src/memberSuggestion/rank.ts";
import { searchMemberSuggestions as coreSearch } from "../src/memberSuggestion/search.ts";

// Same data crosses both implementations; CURRENT remains the reference until
// the endpoint (RH-019) is cut over. Includes aliases, Unicode, recent rows,
// approval filtering and unstable-looking equal-score tie breakers.
const items = [
  { x_user_id: "alice", name: "Alice", xAliases: [], nameAliases: [], occurrenceCount: 1, lastSeenAt: null, approvalStatus: "approved" },
  { x_user_id: "alice_animation", name: "Popular Alice", xAliases: [], nameAliases: [], occurrenceCount: 100, lastSeenAt: null, approvalStatus: "approved" },
  { x_user_id: "bob", name: "Bob", xAliases: [], nameAliases: [], occurrenceCount: 2, lastSeenAt: null, approvalStatus: "pending" },
  { x_user_id: "mochi_new", name: "モチ", xAliases: ["mochi_old"], nameAliases: ["旧名義", "もち"], occurrenceCount: 10, lastSeenAt: 50000, approvalStatus: "approved" },
  { x_user_id: "alice_alt", name: "Alice", xAliases: [], nameAliases: ["Alicia"], occurrenceCount: 2, lastSeenAt: 30000, approvalStatus: "rejected" },
];
const nowSec = 100000;

test("MIG-0648 U01a: same Unicode search normalization and candidate prefilter as CURRENT", () => {
  for (const q of ["＠ＡＬＩＣＥ", "モチ", "もち", "旧名義", "alixe", "alice", "ab", "@", ""]) {
    assert.equal(coreNormalize(q), currentNormalize(q), q);
    assert.deepEqual(corePrefilter(items, q), currentPrefilter(items, q), q);
  }
});

test("MIG-0648 U01a: exact/alias/fuzzy scores and tie-breaks stay identical", () => {
  for (const q of ["alice", "alixe", "＠ＡＬＩＣＥ", "mochi_old", "旧名義", "もち", "bob", "zzz", ""]) {
    assert.deepEqual(coreRank(items, q, nowSec), currentRank(items, q, nowSec), q);
  }
});

test("MIG-0648 U01a: approval filtering, pagination and nextOffset are unchanged", () => {
  for (const q of ["alice", "mochi_old", "alixe", "bob", ""]) {
    for (const onlyApproved of [true, false]) {
      for (const [offset, limit] of [[0, 1], [0, 20], [1, 1], [20, 20]]) {
        const params = { query: q, limit, offset, onlyApproved, nowSec };
        assert.deepEqual(coreSearch(items, params), currentSearch(items, params), JSON.stringify(params));
      }
    }
  }
});
