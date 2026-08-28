import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMemberSuggestionArtifacts,
  buildMemberSuggestionItems,
  memberSuggestionsGenerationMaterial,
  memberSuggestionsIndexObjectKey,
  parseMemberSuggestionsIndex,
  parseMemberSuggestionsManifest,
  assertMemberSuggestionsRowLimit,
  MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
  MEMBER_SUGGESTIONS_MAX_ROWS,
  MEMBER_SUGGESTIONS_MAX_X_ALIASES,
} from "./memberSuggestionsCore.ts";

test("Foo / foo / FOO は正規化X ID foo の1件へ統合される", () => {
  const items = buildMemberSuggestionItems([
    { x_user_id: "Foo", name: "Foo A", isProfileName: true },
    { x_user_id: "foo", nameAliases: ["legacy"] },
    { x_user_id: "@FOO", nameAliases: ["newest"], occurrenceCount: 2 },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].x_user_id, "foo");
});

test("表示名はプロフィール名を正本とし大文字小文字を保持する", () => {
  const items = buildMemberSuggestionItems([
    { x_user_id: "mochi", nameAliases: ["Old History"] },
    { x_user_id: "mochi", name: "MoChi Profile", isProfileName: true },
  ]);
  assert.equal(items[0].name, "MoChi Profile");
  assert.ok(items[0].nameAliases.includes("Old History"));
});

test("プロフィール名が無い場合は最新の履歴表示名へfallbackする", () => {
  const items = buildMemberSuggestionItems([
    { x_user_id: "abc", nameAliases: ["Newest Name"], occurrenceCount: 1 },
    { x_user_id: "abc", nameAliases: ["Older Name"], occurrenceCount: 1 },
  ]);
  assert.equal(items[0].name, "Newest Name");
  assert.deepEqual(items[0].nameAliases, ["Older Name"]);
});

test("どの名前も無い場合は @xid 相当へfallbackする", () => {
  const items = buildMemberSuggestionItems([{ x_user_id: "xyz" }]);
  assert.equal(items[0].name, "@xyz");
});

test("occurrenceCountとlastSeenAtは集約される", () => {
  const items = buildMemberSuggestionItems([
    { x_user_id: "a", occurrenceCount: 3, lastSeenAt: 100 },
    { x_user_id: "A", occurrenceCount: 4, lastSeenAt: 200 },
  ]);
  assert.equal(items[0].occurrenceCount, 7);
  assert.equal(items[0].lastSeenAt, 200);
});

test("xAliases / nameAliasesは重複排除され、上限で打ち切られる", () => {
  const entries = [];
  for (let i = 0; i < 20; i += 1) {
    entries.push({ x_user_id: "dup", xAliases: [`alias${i % 5}`] });
  }
  for (let i = 0; i < 20; i += 1) {
    entries.push({ x_user_id: "dup", nameAliases: [`Name ${i}`] });
  }
  const items = buildMemberSuggestionItems(entries);
  assert.equal(items.length, 1);
  assert.ok(items[0].xAliases.length <= 12);
  assert.ok(items[0].nameAliases.length <= 12);
  assert.equal(new Set(items[0].xAliases).size, items[0].xAliases.length);
  // 名前は最初の履歴名が正本になり、以降は上限までaliasへ入る。
  assert.equal(items[0].name, "Name 0");
});

test("出力は正規化X ID昇順で決定的", () => {
  const source = [
    { x_user_id: "zulu" },
    { x_user_id: "Alpha" },
    { x_user_id: "@beta" },
  ];
  const first = buildMemberSuggestionItems(source);
  const second = buildMemberSuggestionItems([...source].reverse());
  assert.deepEqual(first.map((i) => i.x_user_id), ["alpha", "beta", "zulu"]);
  assert.deepEqual(first, second);
});

test("generation materialは内容依存で同一内容なら同一入力になる", () => {
  const items = buildMemberSuggestionItems([
    { x_user_id: "a", name: "A", occurrenceCount: 2 },
    { x_user_id: "b", name: "B" },
  ]);
  const materialA = memberSuggestionsGenerationMaterial(items);
  const materialB = memberSuggestionsGenerationMaterial(
    buildMemberSuggestionItems([
      { x_user_id: "b", name: "B" },
      { x_user_id: "a", name: "A", occurrenceCount: 2 },
    ]),
  );
  // 順序はsort済みなので並び替えても同一。
  assert.equal(materialA, materialB);

  const changed = buildMemberSuggestionItems([
    { x_user_id: "a", name: "Renamed", occurrenceCount: 2 },
    { x_user_id: "b", name: "B" },
  ]);
  assert.notEqual(memberSuggestionsGenerationMaterial(changed), materialA);
});

test("artifact構築とobject key検証", () => {
  const items = buildMemberSuggestionItems([{ x_user_id: "mochi", name: "Mochi" }]);
  const { manifest, index } = buildMemberSuggestionArtifacts({
    items,
    generatedAt: 1234567890,
    generation: "abc123",
  });
  assert.equal(
    MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
    "internal/member-suggestions/v1/manifest.json",
  );
  assert.equal(
    memberSuggestionsIndexObjectKey("abc123"),
    "internal/member-suggestions/v1/g/abc123/index.json",
  );
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.total, 1);
  assert.equal(manifest.object_key, memberSuggestionsIndexObjectKey("abc123"));
  assert.equal(index.generation, "abc123");
  assert.equal(index.items[0].x_user_id, "mochi");
  assert.throws(() => memberSuggestionsIndexObjectKey("../evil"));
});

test("manifest / index payload検証は不正をnullで拒否する", () => {
  const items = buildMemberSuggestionItems([{ x_user_id: "mochi", name: "Mochi" }]);
  const { manifest, index } = buildMemberSuggestionArtifacts({
    items,
    generatedAt: 1,
    generation: "gen1",
  });
  assert.ok(parseMemberSuggestionsManifest(manifest));
  assert.equal(parseMemberSuggestionsManifest({ ...manifest, schema_version: 99 }), null);
  assert.equal(parseMemberSuggestionsManifest({ ...manifest, generation: "../x" }), null);
  // object_keyはreaderがgenerationから再生成するためlegacy欠落/差分を許容する。
  assert.ok(parseMemberSuggestionsManifest({ ...manifest, object_key: "wrong/index.json" }));
  assert.equal(
    parseMemberSuggestionsManifest({ ...manifest, total: MEMBER_SUGGESTIONS_MAX_ROWS + 1 }),
    null,
  );
  assert.equal(parseMemberSuggestionsManifest(null), null);
  assert.ok(parseMemberSuggestionsIndex(index, "gen1"));
  // generation不一致は拒否。
  assert.equal(parseMemberSuggestionsIndex(index, "other"), null);
  assert.equal(parseMemberSuggestionsIndex({ ...index, schema_version: 2 }, "gen1"), null);
  assert.equal(
    parseMemberSuggestionsIndex({ ...index, items: [{ x_user_id: "UPPER" }] }, "gen1"),
    null,
  );
  assert.equal(parseMemberSuggestionsIndex({ ...index, items: "x" }, "gen1"), null);
  // 大文字小文字違いの混入も拒否（lowercase正本）。
  assert.equal(
    parseMemberSuggestionsIndex(
      { ...index, items: [{ ...index.items[0], x_user_id: "MOCHI" }] },
      "gen1",
    ),
    null,
  );
  assert.equal(
    parseMemberSuggestionsIndex(
      {
        ...index,
        items: [
          {
            ...index.items[0],
            xAliases: Array.from(
              { length: MEMBER_SUGGESTIONS_MAX_X_ALIASES + 1 },
              (_, i) => `alias${i}`,
            ),
          },
        ],
      },
      "gen1",
    ),
    null,
  );
  assert.equal(
    parseMemberSuggestionsIndex(
      { ...index, items: [{ ...index.items[0], xAliases: ["INVALID-ALIAS"] }] },
      "gen1",
    ),
    null,
  );
  assert.equal(
    parseMemberSuggestionsIndex(
      { ...index, items: [{ ...index.items[0], occurrenceCount: 1.5 }] },
      "gen1",
    ),
    null,
  );
});

test("row count guardは超過でthrowする", () => {
  const items = Array.from({ length: 3 }, (_, i) => ({
    x_user_id: `u${i}`,
    name: `U${i}`,
    xAliases: [],
    nameAliases: [],
    occurrenceCount: 0,
    lastSeenAt: null,
    approvalStatus: null,
  }));
  assert.doesNotThrow(() => assertMemberSuggestionsRowLimit(items));
});
