import assert from "node:assert/strict";
import test from "node:test";
import {
  extractVideoMemberIdFromChapterId,
  projectMemberChapters,
} from "../video/memberChapterProjection.ts";

test(":member:から正しいmember ID", () => {
  assert.equal(
    extractVideoMemberIdFromChapterId("vm_abc:member:chapter1"),
    "vm_abc",
  );
});

test(":legacy:から正しいmember ID", () => {
  assert.equal(
    extractVideoMemberIdFromChapterId("vm_legacy:legacy:note"),
    "vm_legacy",
  );
});

test("公開メンバーsetにないchapterを除外し名前推測しない", () => {
  const projected = projectMemberChapters({
    chapters: [
      {
        id: "vm_ok:member:a",
        chapter_time: 1,
        chapter_label: "a",
        note: null,
      },
      {
        id: "vm_hidden:member:b",
        chapter_time: 2,
        chapter_label: "b",
        note: null,
      },
      {
        id: "plain-id",
        chapter_time: 3,
        chapter_label: "plain",
        note: null,
      },
    ],
    publicMemberIds: new Set(["vm_ok"]),
  });
  assert.deepEqual(
    projected.map((row) => row.video_member_id),
    ["vm_ok"],
  );
});
