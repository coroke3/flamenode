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

test("非公開メンバーの明示chapterを除外する", () => {
  const projected = projectMemberChapters({
    chapters: [
      {
        id: "vm_ok:member:a",
        x_user_id: "member_ok",
        chapter_time: 1,
        chapter_label: "a",
        note: null,
      },
      {
        id: "vm_hidden:member:b",
        x_user_id: "member_hidden",
        chapter_time: 2,
        chapter_label: "b",
        note: null,
      },
    ],
    publicMembers: [
      {
        id: "vm_ok",
        x_user_id: "member_ok",
      },
    ],
  });

  assert.deepEqual(
    projected.map((row) => row.video_member_id),
    ["vm_ok"],
  );
});

test("明示member IDがない場合は一意なX ID一致を使う", () => {
  const projected = projectMemberChapters({
    chapters: [
      {
        id: "plain-id",
        x_user_id: "Member_A",
        chapter_time: 3,
        chapter_label: "plain",
        note: null,
      },
    ],
    publicMembers: [
      {
        id: "vm_a",
        x_user_id: "member_a",
      },
    ],
  });

  assert.deepEqual(
    projected.map((row) => row.video_member_id),
    ["vm_a"],
  );
});

test("同じX IDの公開メンバーが複数ある場合は推測しない", () => {
  const projected = projectMemberChapters({
    chapters: [
      {
        id: "plain-id",
        x_user_id: "member_a",
        chapter_time: 3,
        chapter_label: "plain",
        note: null,
      },
    ],
    publicMembers: [
      {
        id: "vm_a1",
        x_user_id: "member_a",
      },
      {
        id: "vm_a2",
        x_user_id: "member_a",
      },
    ],
  });

  assert.deepEqual(projected, []);
});
