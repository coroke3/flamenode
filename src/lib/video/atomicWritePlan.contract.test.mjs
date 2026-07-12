import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const create = read("../actions/video/createFreeVideo.ts");
const submit = read("../actions/video/submitSlotVideo.ts");
const update = read("./videoSavePlan.ts");
const adminMembers = read("../actions/video/adminMembers.ts");
const helperSources = [
  read("./ensureSubmissionXUser.ts"),
  read("./syncVideoEvents.ts"),
  read("./replaceVideoMembers.ts"),
  read("../db/software.ts"),
  read("./customQuestionAnswers.ts"),
  read("./stagePermissionAnswers.ts"),
];

test("投稿・枠投稿・編集・管理メンバー更新は各1回だけatomic planを実行する", () => {
  for (const source of [create, submit, update, adminMembers]) {
    assert.equal((source.match(/executeVideoAtomicWritePlan\(db,/g) ?? []).length, 1);
    assert.doesNotMatch(source, /auditAction\(/);
  }
  assert.match(create, /buildNotificationOutboxStatement/);
  assert.match(submit, /buildNotificationOutboxStatement/);
  assert.match(create, /plan\.statements\.push\(\.\.\.queue\.statements\)/);
  assert.match(submit, /plan\.statements\.push\(\.\.\.queue\.statements\)/);
});

test("旧逐次write helperとmutation後のDB queue書込みを残さない", () => {
  const combined = [create, submit, update].join("\n");
  for (const obsolete of [
    "ensureSubmissionXUser(",
    "ensureVideoDerivedRows(",
    "replaceVideoMembers(",
    "replaceVideoSoftwareLabels(",
    "syncVideoEvents(",
    "replaceStagePermissionCustomAnswers(",
    "replaceGeneralCustomAnswers(",
    "recordXIconCandidateFromVideo(",
    "recordYoutubeChannelCandidateFromVideo(",
    "enqueueAfterVideoCreate(",
    "enqueueAfterVideoUpdate(",
  ]) assert.doesNotMatch(combined, new RegExp(obsolete.replace("(", "\\(")));
  for (const source of helperSources) {
    assert.doesNotMatch(source, /await db\s*\.(insert|update|delete)\(/);
  }
});

test("更新・削除planは全scalar snapshot CASを共通利用する", () => {
  for (const source of helperSources) {
    if (!/\.update\(|\.delete\(/.test(source)) continue;
    assert.match(source, /expectedRowCondition\(\{ expectedCurrent:/);
  }
  assert.match(update, /expectedRowCondition\(\{ expectedCurrent: plan\.target \}\)/);
  assert.match(submit, /expectedRowCondition\(\{ expectedCurrent: existingVideo \}\)/);
  assert.match(submit, /expectedRowCondition\(\{ expectedCurrent: row \}\)/);
});

test("1 statementの最悪bind数はD1上限100未満に固定する", () => {
  const member = read("./replaceVideoMembers.ts");
  const software = read("../db/software.ts");
  assert.match(member, /MAX_ATOMIC_VIDEO_MEMBERS = 4/);
  assert.match(software, /MAX_ATOMIC_VIDEO_SOFTWARES = 4/);
  // video_members is currently 15 scalar columns plus the repeated id predicate.
  assert.ok(4 * 16 < 100);
  // video_softwares is 4 scalar columns plus repeated PK predicates.
  assert.ok(4 * 6 < 100);
});

test("主要行の監査は投影ではなく完全なbefore/after rowを保持する", () => {
  assert.match(create, /after: \{ \.\.\.videoAfter \}/);
  assert.match(submit, /before: existingVideo \? \{ \.\.\.existingVideo \} : null/);
  assert.match(submit, /after: \{ \.\.\.videoAfter \}/);
  assert.match(update, /before: \{ \.\.\.plan\.target \}/);
  assert.match(update, /const after = \{ \.\.\.plan\.target, \.\.\.payload \}/);
});
