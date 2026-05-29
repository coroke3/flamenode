import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeMemberChapterTime,
  parseMemberChapterTime,
  parseVideoMemberCsv,
} from "./memberInput.ts";

test("parseMemberChapterTime accepts mm:ss values", () => {
  assert.equal(parseMemberChapterTime("0:00"), 0);
  assert.equal(parseMemberChapterTime("1:23"), 83);
  assert.equal(parseMemberChapterTime("12:34"), 754);
  assert.equal(parseMemberChapterTime("9999:59"), 599999);
});

test("parseMemberChapterTime rejects invalid values", () => {
  assert.equal(parseMemberChapterTime("bad"), null);
  assert.equal(parseMemberChapterTime("1:60"), null);
  assert.equal(parseMemberChapterTime("10000:00"), null);
  assert.equal(normalizeMemberChapterTime("1:5"), "1:05");
});

test("parseVideoMemberCsv reads header rows and strips @ from X ID", () => {
  const parsed = parseVideoMemberCsv(
    "name,x_user_id,role,comment\n表示名,@xid,担当,コメント",
  );
  assert.equal(parsed.members.length, 1);
  assert.deepEqual(parsed.members[0], {
    name: "表示名",
    x_user_id: "xid",
    role: "担当",
    comment: "コメント",
    chapters: [],
  });
});

test("parseVideoMemberCsv reads no-header four-column rows", () => {
  const parsed = parseVideoMemberCsv("表示名,xid,担当,コメント");
  assert.equal(parsed.members[0]?.role, "担当");
  assert.equal(parsed.members[0]?.comment, "コメント");
});

test("parseVideoMemberCsv ignores empty rows and preserves comma comments", () => {
  const parsed = parseVideoMemberCsv(
    "\n表示名,xid,担当,\"コメントに,カンマ\"\n\n",
  );
  assert.equal(parsed.members.length, 1);
  assert.equal(parsed.members[0]?.comment, "コメントに,カンマ");
});

test("parseVideoMemberCsv reads chapter column when present", () => {
  const parsed = parseVideoMemberCsv("表示名,xid,0:12;1:05,担当,コメント");
  assert.equal(parsed.members[0]?.chapters?.length, 2);
  assert.equal(parsed.members[0]?.chapters?.[1]?.time, "1:05");
});

test("parseVideoMemberCsv warns for broken and duplicate rows", () => {
  const parsed = parseVideoMemberCsv("name,x_user_id,role,comment\n,,,\nA,dup,r,c\nB,@dup,r,c");
  assert.equal(parsed.members.length, 2);
  assert.ok(parsed.warnings.some((w) => w.includes("読み飛ばしました")));
  assert.ok(parsed.warnings.some((w) => w.includes("@dup")));
});
