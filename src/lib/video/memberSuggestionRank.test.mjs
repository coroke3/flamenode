import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeMemberSearchText,
  rankMemberSuggestionCandidates,
} from "./memberSuggestionRank.ts";

describe("normalizeMemberSearchText", () => {
  it("normalizes full-width characters and leading at signs", () => {
    assert.equal(
      normalizeMemberSearchText(
        "＠Ａｌｉｃｅ ",
      ),
      "alice",
    );
  });

  it("normalizes katakana to hiragana", () => {
    assert.equal(
      normalizeMemberSearchText("モチ"),
      "もち",
    );
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
    const ranked =
      rankMemberSuggestionCandidates(
        candidates,
        "alice",
      );

    assert.equal(
      ranked[0]?.x_user_id,
      "alice",
    );
    assert.equal(
      ranked[0]?.matchedBy,
      "xid_exact",
    );
  });

  it("matches an old X ID alias", () => {
    const ranked =
      rankMemberSuggestionCandidates(
        candidates,
        "mochi_old",
      );

    assert.equal(
      ranked[0]?.x_user_id,
      "mochi_new",
    );
    assert.equal(
      ranked[0]?.matchedBy,
      "xid_alias_exact",
    );
  });

  it("matches historical display names", () => {
    const ranked =
      rankMemberSuggestionCandidates(
        candidates,
        "旧名義",
      );

    assert.equal(
      ranked[0]?.x_user_id,
      "mochi_new",
    );
    assert.equal(
      ranked[0]?.matchedBy,
      "name_alias_exact",
    );
  });

  it("handles a one-character typo", () => {
    const ranked =
      rankMemberSuggestionCandidates(
        candidates,
        "alicee",
      );

    assert.equal(
      ranked[0]?.x_user_id,
      "alice",
    );
    assert.equal(
      ranked[0]?.matchedBy,
      "fuzzy_1",
    );
  });
});
