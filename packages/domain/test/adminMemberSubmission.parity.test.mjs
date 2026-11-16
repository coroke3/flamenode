import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  parseVideoMemberInputs as targetParse,
  normalizeMemberChapters as targetChapters,
  validateVideoMemberSubmission as targetSubmission,
  classifyAdminVideoMemberSave,
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

function legacySubmission(formData, isCollab) {
  const parsed = legacyParse(formData.get("members_json"), isCollab);
  if (!parsed.ok) return parsed;
  const chaptersByIndex = new Map();
  for (let i = 0; i < parsed.members.length; i++) {
    const normalized = legacyChapters(parsed.members[i], i);
    if (!normalized.ok) return normalized;
    chaptersByIndex.set(i, normalized.chapters);
  }
  return { ok: true, value: { members: parsed.members, chaptersByIndex } };
}
function submission(input, isCollab) {
  const formData = new FormData();
  if (input !== null) formData.set("members_json", input);
  const actual = targetSubmission(formData, isCollab);
  assert.deepEqual(actual, legacySubmission(formData, isCollab));
  return actual;
}

test("MIG-0650 SA-085 U03b: full FormData member + chapter validation matches CURRENT", () => {
  const valid = submission(encode([
    member("@ALICE", {
      chapters: [
        { time: "1:23", label: "", note: "" },
        { time: "5:04", label: " Outro ", note: " text " },
      ],
    }),
    member("bob", { name: "Bob", role: "", chapters: [] }),
  ]), true);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value.chaptersByIndex.get(0).map(x => x.order_index), [0, 1]);
  assert.equal(valid.value.chaptersByIndex.get(0)[0].time_seconds, 83);
  assert.equal(valid.value.chaptersByIndex.get(0)[0].label, "映像");
  assert.deepEqual(valid.value.chaptersByIndex.get(1), []);
});

test("MIG-0650 SA-085 U03b: collaboration OFF discards even hostile member payload", () => {
  for (const raw of [null, "{", "null", encode([member("alice")])]) {
    const outcome = submission(raw, false);
    assert.deepEqual(outcome, { ok: true, value: {
      members: [], chaptersByIndex: new Map(),
    } });
  }
});

test("MIG-0650 SA-085 U03b: full submit rejects invalid time, duplicate X ID, and >100 rows", () => {
  const cases = [
    encode([member("alice", { chapters: [{ time: "5:60", label: "", note: "" }] })]),
    encode([member("ALICE"), member("@alice")]),
    encode(Array.from({ length: 101 }, (_, i) => member("user_" + i))),
  ];
  for (const raw of cases) {
    const outcome = submission(raw, true);
    assert.equal(outcome.ok, false);
  }
});

test("MIG-0650 SA-085 U03b: active Next submission entry delegates only members validation to domain", async () => {
  const nextSource = await readFile(new URL("../../../src/lib/video/submissionValidation.ts", import.meta.url), "utf8");
  const domainExport = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.match(nextSource, /export \{ validateVideoMemberSubmission \} from "@flamenode\/domain\/video\/adminMemberSubmission"/);
  assert.match(nextSource, /export type \{ ValidatedMemberSubmission \}/);
  assert.match(nextSource, /export async function validateCustomAnswersForEvents/);
  assert.doesNotMatch(nextSource, /function validateVideoMemberSubmission\s*\(/);
  assert.equal(
    JSON.parse(domainExport).exports["./video/adminMemberSubmission"],
    "./src/video/adminMemberSubmission.ts",
  );
});

test("MIG-0650 SA-085 U03c: public-content dirtiness and no-op classification match CURRENT", () => {
  for (const previousCollaborationType of ["collab", "individual", "legacy", null]) {
    for (const memberCount of [0, 1, 100]) {
      for (const isCollab of [false, true]) {
        for (const hasMemberAudit of [false, true]) {
          for (const hasChapterAudit of [false, true]) {
            const expectedType = memberCount > 0 || isCollab ? "collab" : "individual";
            const changed = previousCollaborationType !== expectedType;
            assert.deepEqual(classifyAdminVideoMemberSave({
              previousCollaborationType, memberCount, isCollab,
              hasMemberAudit, hasChapterAudit,
            }), {
              nextCollaborationType: expectedType,
              collaborationTypeChanged: changed,
              videoPublicContentChanged: changed || hasMemberAudit || hasChapterAudit,
            });
          }
        }
      }
    }
  }
  assert.equal(classifyAdminVideoMemberSave({
    previousCollaborationType: "collab", memberCount: 0, isCollab: true,
    hasMemberAudit: false, hasChapterAudit: false,
  }).videoPublicContentChanged, false);
});
