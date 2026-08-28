import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeMemberSearchText,
  prefilterMemberSuggestionCandidates,
  rankMemberSuggestionCandidates,
  scoreSimpleMemberSuggestion,
} from "./memberSuggestionRank.ts";

describe("normalizeMemberSearchText", () => {
  it("normalizes full-width characters and leading at signs", () => {
    assert.equal(normalizeMemberSearchText("＠Ａｌｉｃｅ "), "alice");
  });

  it("normalizes katakana to hiragana", () => {
    assert.equal(normalizeMemberSearchText("モチ"), "もち");
  });
});

describe("prefilterMemberSuggestionCandidates", () => {
  it("does not keep short-query candidates only because their length is close", () => {
    const filtered = prefilterMemberSuggestionCandidates(
      [
        { x_user_id: "ab_creator", name: "AB Creator" },
        { x_user_id: "zz", name: "ZZ" },
        { x_user_id: "xy", name: "XY" },
      ],
      "ab",
    );
    assert.deepEqual(
      filtered.map((item) => item.x_user_id),
      ["ab_creator"],
    );
  });

  it("keeps the fuzzy length window for queries of at least three characters", () => {
    const filtered = prefilterMemberSuggestionCandidates(
      [
        { x_user_id: "alice", name: "Alice" },
        { x_user_id: "zzzzz", name: "ZZZZZ" },
      ],
      "alixe",
    );
    assert.ok(filtered.some((item) => item.x_user_id === "alice"));
  });
});

describe("rankMemberSuggestionCandidates", () => {
  const candidates = [
    {
      x_user_id: "alice",
      name: "Alice",
      occurrenceCount: 1,
    },
    {
      x_user_id: "alice_animation",
      name: "Popular Alice",
      occurrenceCount: 100,
    },
    {
      x_user_id: "mochi_new",
      name: "Mochi",
      xAliases: ["mochi_old"],
      nameAliases: ["旧名義"],
      occurrenceCount: 10,
    },
  ];

  it("keeps an exact X ID above popular partial matches", () => {
    const ranked = rankMemberSuggestionCandidates(candidates, "alice");

    assert.equal(ranked[0]?.x_user_id, "alice");
    assert.equal(ranked[0]?.matchedBy, "xid_exact");
  });

  it("matches an old X ID alias", () => {
    const ranked = rankMemberSuggestionCandidates(candidates, "mochi_old");

    assert.equal(ranked[0]?.x_user_id, "mochi_new");
    assert.equal(ranked[0]?.matchedBy, "xid_alias_exact");
  });

  it("matches historical display names", () => {
    const ranked = rankMemberSuggestionCandidates(candidates, "旧名義");

    assert.equal(ranked[0]?.x_user_id, "mochi_new");
    assert.equal(ranked[0]?.matchedBy, "name_alias_exact");
  });

  it("handles a one-character typo", () => {
    const ranked = rankMemberSuggestionCandidates(candidates, "alicee");

    assert.equal(ranked[0]?.x_user_id, "alice");
    assert.equal(ranked[0]?.matchedBy, "fuzzy_1");
  });

  it("keeps the original 20-point recency bonus over a 365-day window", () => {
    const nowSec = 365 * 86400;
    const ranked = rankMemberSuggestionCandidates(
      [
        {
          x_user_id: "alice_old",
          name: "Alice",
          occurrenceCount: 0,
          lastSeenAt: 0,
        },
        {
          x_user_id: "alice_new",
          name: "Alice",
          occurrenceCount: 0,
          lastSeenAt: nowSec,
        },
      ],
      "alice",
      nowSec,
    );

    const newest = ranked.find((item) => item.x_user_id === "alice_new");
    const oldest = ranked.find((item) => item.x_user_id === "alice_old");
    assert.ok(newest && oldest);
    assert.equal(newest.score - oldest.score, 20);
  });
});

describe("scoreSimpleMemberSuggestion", () => {
  it("keeps the client preload compatibility API", () => {
    assert.equal(
      scoreSimpleMemberSuggestion("alice", {
        x_user_id: "alice",
        name: "Alice",
      }),
      1000,
    );
  });
});
