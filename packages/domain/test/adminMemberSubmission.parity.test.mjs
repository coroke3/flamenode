import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseVideoMemberInputs as targetParse,
  normalizeMemberChapters as targetChapters,
} from "../src/video/adminMemberSubmission.ts";
import {
  parseVideoMemberInputs as legacyParse,
  normalizeMemberChapters as legacyChapters,
} from "../../../src/lib/video/memberInputs.ts";

const encode = rows => JSON.stringify(rows);
const member = (xid = "@ALICE", overrides = {}) => ({
  name: " Alice ", x_user_id: xid, role: " 映像 ", comment: " text ",
  chapters: [{ time: "1:23", label: " Intro ", note: " note " }],
  ...overrides,
});

function parity(raw, isCollab) {
  const actual = targetParse(raw, isCollab);
  const expected = legacyParse(raw, isCollab);
  assert.deepEqual(actual, expected, "shared domain parser must match CURRENT on this input");
  return actual;
}

test("MIG-0650 SA-085 U03: normal member + chapters are byte-meaning identical to CURRENT", () => {
  const result = parity(encode([member(), member("bob", { name: "Bob" })]), true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.members.map(x => x.x_user_id), ["alice", "bob"]);
  assert.equal(result.members[0].chapters[0].time, "1:23");
  assert.deepEqual(targetChapters(result.members[0], 0), legacyChapters(result.members[0], 0));
});

test("MIG-0650 SA-085 U03: empty, malformed, null and non-collaboration contracts", () => {
  for (const raw of [null, "", "  ", "{", "{}", "null", "false", "1", '"text"', "[]"]) {
    parity(raw, true);
    const off = parity(raw, false);
    assert.deepEqual(off, { ok: true, members: [] });
  }
});

test("MIG-0650 SA-085 U03: exactly 100 accepted and 101 rejected before DB writes", () => {
  const hundred = Array.from({ length: 100 }, (_, i) =>
    member("user_" + i, { name: "User " + i, chapters: [] }));
  const accepted = parity(encode(hundred), true);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.members.length, 100);
  const denied = parity(encode([...hundred, member("overflow", { name: "Overflow" })]), true);
  assert.equal(denied.ok, false);
  assert.match(denied.message, /100/);
});

test("MIG-0650 SA-085 U03: normalized duplicate IDs and invalid X ID reject", () => {
  for (const rows of [
    [member("@ALICE"), member("alice")],
    [member("bad-x!d")],
    [member("x".repeat(21))],
  ]) {
    const result = parity(encode(rows), true);
    assert.equal(result.ok, false);
  }
});

test("MIG-0650 SA-085 U03: blank rows, fallback names and edit-only input fields", () => {
  const rows = [
    member("", { name: "  ", role: "  ", chapters: [] }),
    member("@a", { name: "", can_edit: 1, is_public_member: 0, order_index: 999 }),
  ];
  const result = parity(encode(rows), true);
  assert.equal(result.ok, true);
  assert.equal(result.members.length, 1);
  assert.equal(result.members[0].name, "@a");
  assert.equal(Object.hasOwn(result.members[0], "can_edit"), false);
  assert.equal(Object.hasOwn(result.members[0], "is_public_member"), false);
  assert.equal(Object.hasOwn(result.members[0], "order_index"), false);
});

test("MIG-0650 SA-085 U03: field length and 30/31 chapter boundaries", () => {
  const ch = { time: "1:03", label: "scene", note: "note" };
  const variants = [
    member("alice", { name: "A".repeat(81) }),
    member("alice", { role: "R".repeat(81) }),
    member("alice", { comment: "C".repeat(501) }),
    member("alice", { chapters: Array.from({ length: 31 }, () => ch) }),
    member("alice", { chapters: [{ time: "0:00", label: "L".repeat(121), note: "" }] }),
    member("alice", { chapters: [{ time: "0:00", label: "L", note: "N".repeat(1001) }] }),
  ];
  for (const row of variants) {
    const out = parity(encode([row]), true);
    assert.equal(out.ok, false);
  }
  assert.equal(parity(encode([member("alice", {
    chapters: Array.from({ length: 30 }, () => ch),
  })]), true).ok, true);
});

test("MIG-0650 SA-085 U03: chapter times, invalid inputs, and role fallback exactly match CURRENT", () => {
  const accepted = parity(encode([member("alice", {
    chapters: [{ time: "9999:59", label: "", note: "" }],
  })]), true);
  assert.equal(accepted.ok, true);
  const chapters = targetChapters(accepted.members[0], 0);
  assert.deepEqual(chapters, legacyChapters(accepted.members[0], 0));
  assert.equal(chapters.ok, true);
  assert.equal(chapters.chapters[0].time_seconds, 9999 * 60 + 59);
  assert.equal(chapters.chapters[0].label, "映像");

  for (const time of ["", "10000:00", "1:60", "-1:02", "1:2:3", "1"]) {
    const parsed = parity(encode([member("alice", {
      chapters: [{ time, label: "", note: "" }],
    })]), true);
    if (parsed.ok) {
      const actual = targetChapters(parsed.members[0], 0);
      const expected = legacyChapters(parsed.members[0], 0);
      assert.deepEqual(actual, expected);
      assert.equal(actual.ok, false, time);
    }
  }
});

test("MIG-0650 SA-085 U03: every scenario preserves canonical member results and chapter ordinals", () => {
  for (const n of [0, 1, 2, 30, 99, 100]) {
    const rows = Array.from({ length: n }, (_, i) => member("x_" + i, {
      name: "Member " + i,
      chapters: Array.from({ length: i % 5 }, (_, j) => ({
        time: j + ":09", label: "", note: "N" + j,
      })),
    }));
    const actual = parity(encode(rows), true);
    assert.equal(actual.ok, true);
    for (const [index, row] of actual.members.entries()) {
      const converted = targetChapters(row, index);
      assert.deepEqual(converted, legacyChapters(row, index));
      if (converted.ok) {
        assert.deepEqual(converted.chapters.map(ch => ch.order_index), row.chapters.map((_, j) => j));
      }
    }
  }
});
