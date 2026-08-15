import assert from "node:assert/strict";
import { test } from "node:test";
import { remapMemberChaptersByIdentity } from "./memberChapterIdentity.ts";
import { memberChaptersPayloadChanged } from "./memberSubmissionCompare.ts";

const chapter = (time_seconds, label) => ({
  time_seconds,
  label,
  note: "",
  order_index: 0,
});

function baseline(members, chaptersByIndex) {
  return { members, chaptersByIndex };
}

test("member chapters follow normalized X IDs when members are reordered", () => {
  const stored = baseline(
    [
      { name: "Alpha", x_user_id: "Alpha", role: "", comment: "", chapters: [] },
      { name: "Beta", x_user_id: "Beta", role: "", comment: "", chapters: [] },
    ],
    new Map([
      [0, [chapter(12, "Alpha")]],
      [1, [chapter(65, "Beta")]],
    ]),
  );
  const reordered = baseline(
    [
      { name: "Beta", x_user_id: "@beta", role: "", comment: "", chapters: [] },
      { name: "Alpha", x_user_id: "@alpha", role: "", comment: "", chapters: [] },
    ],
    new Map([
      [0, [chapter(65, "Beta")]],
      [1, [chapter(12, "Alpha")]],
    ]),
  );

  const result = remapMemberChaptersByIdentity(stored, reordered);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.bySubmittedIndex.get(0), [chapter(65, "Beta")]);
  assert.deepEqual(result.bySubmittedIndex.get(1), [chapter(12, "Alpha")]);
  assert.deepEqual(result.byBaselineIndex.get(0), [chapter(12, "Alpha")]);
  assert.deepEqual(result.byBaselineIndex.get(1), [chapter(65, "Beta")]);
  assert.equal(result.unmatchedSubmittedWithChapters, false);
});

test("members-only payload with omitted chapters preserves stored rows after reorder", () => {
  const stored = baseline(
    [
      { name: "Alpha", x_user_id: "alpha", role: "", comment: "", chapters: [] },
      { name: "Beta", x_user_id: "beta", role: "", comment: "", chapters: [] },
    ],
    new Map([
      [0, [chapter(12, "Alpha")]],
      [1, [chapter(65, "Beta")]],
    ]),
  );
  const reorderedWithoutChapters = baseline(
    [
      { name: "Beta", x_user_id: "beta", role: "", comment: "", chapters: [] },
      { name: "Alpha", x_user_id: "alpha", role: "", comment: "", chapters: [] },
    ],
    new Map([
      [0, []],
      [1, []],
    ]),
  );

  const result = remapMemberChaptersByIdentity(stored, reorderedWithoutChapters);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.bySubmittedIndex.get(0), [chapter(65, "Beta")]);
  assert.deepEqual(result.bySubmittedIndex.get(1), [chapter(12, "Alpha")]);
  assert.deepEqual(result.byBaselineIndex.get(0), [chapter(12, "Alpha")]);
  assert.deepEqual(result.byBaselineIndex.get(1), [chapter(65, "Beta")]);
  assert.equal(result.unmatchedSubmittedWithChapters, false);
});

test("non-empty chapter edits remain visible to the members-only permission check", () => {
  const stored = baseline(
    [{ name: "Alpha", x_user_id: "alpha", role: "", comment: "", chapters: [] }],
    new Map([[0, [chapter(12, "Alpha")]]]),
  );
  const edited = baseline(
    [{ name: "Alpha", x_user_id: "alpha", role: "", comment: "", chapters: [] }],
    new Map([[0, [chapter(99, "Alpha")]]]),
  );

  const result = remapMemberChaptersByIdentity(stored, edited);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.byBaselineIndex.get(0), [chapter(99, "Alpha")]);
  assert.equal(
    memberChaptersPayloadChanged(stored, {
      ...edited,
      chaptersByIndex: result.byBaselineIndex,
    }),
    true,
  );
});

test("ambiguous fallback names fail closed", () => {
  const stored = baseline(
    [
      { name: "Same", x_user_id: "one", role: "", comment: "", chapters: [] },
      { name: "Same", x_user_id: "two", role: "", comment: "", chapters: [] },
    ],
    new Map([
      [0, [chapter(12, "one")]],
      [1, [chapter(65, "two")]],
    ]),
  );
  const submitted = baseline(
    [{ name: "Same", x_user_id: "", role: "", comment: "", chapters: [] }],
    new Map([[0, []]]),
  );

  assert.deepEqual(remapMemberChaptersByIdentity(stored, submitted), {
    ok: false,
    reason: "ambiguous_member_name",
  });
});

test("new members cannot smuggle chapter edits through a members-only save", () => {
  const stored = baseline(
    [{ name: "Alpha", x_user_id: "alpha", role: "", comment: "", chapters: [] }],
    new Map([[0, [chapter(12, "Alpha")]]]),
  );
  const submitted = baseline(
    [
      { name: "Alpha", x_user_id: "alpha", role: "", comment: "", chapters: [] },
      { name: "New", x_user_id: "new", role: "", comment: "", chapters: [] },
    ],
    new Map([
      [0, [chapter(12, "Alpha")]],
      [1, [chapter(99, "New")]],
    ]),
  );

  const result = remapMemberChaptersByIdentity(stored, submitted);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.unmatchedSubmittedWithChapters, true);
});
