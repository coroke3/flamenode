import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeMemberChapterTime,
  parseMemberChapterTime,
  parseVideoMemberCsv,
  parseVideoMemberDelimited,
  parseVideoMemberText,
  serializeVideoMemberTsv,
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

test("parseVideoMemberText reads spreadsheet TSV with 6 columns and permission", () => {
  const parsed = parseVideoMemberText(
    "Alice\talice_x\t1:23\t映像\tモーション担当\tON\nBob\tbob123\t12:05\tイラスト\t背景担当\tOFF",
  );
  assert.equal(parsed.members.length, 2);
  assert.equal(parsed.members[0]?.can_edit, 1);
  assert.equal(parsed.members[1]?.can_edit, 0);
  assert.deepEqual(parsed.members[0]?.chapters?.map((c) => c.time), ["1:23"]);
});

test("parseVideoMemberText keeps intermediate empty cells by tab position", () => {
  const parsed = parseVideoMemberText("Alice\talice_x\t1:23\t\tコメント\tON");
  const member = parsed.members[0];
  assert.equal(member?.role, "");
  assert.equal(member?.comment, "コメント");
  assert.equal(member?.can_edit, 1);
  assert.deepEqual(member?.chapters?.map((c) => c.time), ["1:23"]);
});

test("parseVideoMemberText accepts trailing column omission (1-2 columns)", () => {
  const two = parseVideoMemberText("Alice\talice_x");
  assert.equal(two.members[0]?.name, "Alice");
  assert.equal(two.members[0]?.x_user_id, "alice_x");
  assert.equal(two.members[0]?.role, "");
  const one = parseVideoMemberText("Alice");
  assert.equal(one.members[0]?.name, "Alice");
  assert.equal(one.members[0]?.x_user_id, "");
});

test("parseVideoMemberText reads header rows with TSV aliases", () => {
  const parsed = parseVideoMemberText(
    "ユーザー名\tX ID\tチャプター\t役職\tコメント\t権限\n表示名\t@xid\t0:12\t作画\tよろしく\tはい",
  );
  assert.equal(parsed.members.length, 1);
  assert.equal(parsed.members[0]?.x_user_id, "xid");
  assert.equal(parsed.members[0]?.can_edit, 1);
  assert.equal(parsed.members[0]?.role, "作画");
});

test("parseVideoMemberText parses 6th permission column without header", () => {
  const parsed = parseVideoMemberText("Alice\talice_x\t0:12\t作画\tコメント\tいいえ");
  assert.equal(parsed.members[0]?.can_edit, 0);
});

test("parseVideoMemberText accepts all documented permission values", () => {
  for (const [raw, expected] of [
    ["ON", 1],
    ["OFF", 0],
    ["true", 1],
    ["false", 0],
    ["1", 1],
    ["0", 0],
    ["yes", 1],
    ["no", 0],
    ["はい", 1],
    ["いいえ", 0],
  ]) {
    const parsed = parseVideoMemberText(`A\ta\t\t\t\t${raw}`);
    assert.equal(parsed.members[0]?.can_edit, expected, `permission ${raw}`);
  }
});

test("parseVideoMemberText warns duplicate X IDs across case variants", () => {
  const parsed = parseVideoMemberText("A\t@Dup\nB\tdup");
  assert.ok(parsed.warnings.some((w) => w.includes("@dup")));
});

test("parseVideoMemberDelimited keeps legacy CSV behavior", () => {
  const parsed = parseVideoMemberDelimited(
    "表示名,xid,担当,\"コメントに,カンマ\"",
    ",",
  );
  assert.equal(parsed.members.length, 1);
  assert.equal(parsed.members[0]?.comment, "コメントに,カンマ");
});

test("parseVideoMemberText handles quoted tab cells in TSV", () => {
  const parsed = parseVideoMemberText('A\ta\t\t\t"コメント\t内タブ"\tON');
  assert.equal(parsed.members[0]?.comment, "コメント\t内タブ");
});

test("parseVideoMemberText parses multiple chapters separated by semicolons", () => {
  const parsed = parseVideoMemberText("A\ta\t0:12;1:05;2:30\t役割");
  assert.deepEqual(parsed.members[0]?.chapters?.map((c) => c.time), [
    "0:12",
    "1:05",
    "2:30",
  ]);
});

test("TSV export/import round trip preserves member information", () => {
  const original = [
    {
      name: "Alice",
      x_user_id: "@Alice_X",
      role: "映像",
      comment: "担当",
      chapters: [{ time: "1:5", label: "", note: "" }],
      can_edit: 1,
    },
    {
      name: "Bob",
      x_user_id: "bob123",
      role: "イラスト",
      comment: "",
      chapters: [],
      can_edit: 0,
    },
    { name: "Carol", x_user_id: "", role: "", comment: "", chapters: [] },
  ];
  const tsv = serializeVideoMemberTsv(original);
  // 常に6セルを維持する（末尾空欄も位置を保つ）。
  assert.equal(tsv.split("\n")[0]?.split("\t").length, 6);
  assert.equal(tsv.split("\n")[2], "Carol\t\t\t\t\t");
  const parsed = parseVideoMemberText(tsv);
  assert.deepEqual(
    parsed.members.map((m) => ({
      name: m.name,
      x_user_id: m.x_user_id,
      role: m.role,
      comment: m.comment,
      can_edit: m.can_edit,
      chapterCount: m.chapters?.length ?? 0,
      firstChapter: m.chapters?.[0]?.time,
    })),
    [
      {
        name: "Alice",
        x_user_id: "alice_x",
        role: "映像",
        comment: "担当",
        can_edit: 1,
        chapterCount: 1,
        firstChapter: "1:05",
      },
      {
        name: "Bob",
        x_user_id: "bob123",
        role: "イラスト",
        comment: "",
        can_edit: 0,
        chapterCount: 0,
        firstChapter: undefined,
      },
      {
        name: "Carol",
        x_user_id: "",
        role: "",
        comment: "",
        can_edit: undefined,
        chapterCount: 0,
        firstChapter: undefined,
      },
    ],
  );
});
