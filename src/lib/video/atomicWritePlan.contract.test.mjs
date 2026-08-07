import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const create = read("../actions/video/createFreeVideo.ts");
const submit = read("../actions/video/submitSlotVideo.ts");
const updateVideoAction = read("../actions/video/updateVideo.ts");
const update = read("./videoSavePlan.ts");
const adminMembers = read("../actions/video/adminMembers.ts");
const helperSources = [
  read("./syncVideoEvents.ts"),
  read("./replaceVideoMembers.ts"),
  read("../db/software.ts"),
  read("./customQuestionAnswers.ts"),
  read("./stagePermissionAnswers.ts"),
];

test("YouTube IDがあるときだけderived rows planを追加する", () => {
  assert.match(submit, /if \(youtubeFieldPresent && submittedYoutubeId\) \{[\s\S]*buildVideoDerivedRowsPlan/);
  assert.match(submit, /else if \(existingVideo && youtubeFieldPresent\) \{[\s\S]*buildVideoMetadataClearPlan/);
  assert.match(update, /if \(sections\.youtube && plan\.youtubeChanged\)[\s\S]*buildVideoDerivedRowsPlan/);
});

test("枠投稿と編集はYouTube任意パースを使う", () => {
  assert.match(submit, /parseVideoForm\([\s\S]*youtubeRequired: false/);
  assert.match(updateVideoAction, /parseVideoForm\(raw, \{ youtubeRequired: false \}\)/);
  assert.match(updateVideoAction, /if \(sections\.youtube && youtubeChanged && youtubeId\)/);
});

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

test("更新・削除planはscalar CASまたは集合CASを利用する", () => {
  for (const source of helperSources) {
    if (!/\.update\(|\.delete\(/.test(source)) {
      continue;
    }

    if (
      source.includes(
        "buildVideoMemberSetGuardSql",
      )
    ) {
      assert.match(
        source,
        /buildVideoMemberSetGuardSql/,
      );
      continue;
    }

    assert.match(
      source,
      /expectedRowCondition\(\{ expectedCurrent:/,
    );
  }

  assert.match(
    update,
    /expectedRowCondition\(\{ expectedCurrent: plan\.target \}\)/,
  );
  assert.match(
    submit,
    /expectedRowCondition\(\{ expectedCurrent: existingVideo \}\)/,
  );
  assert.match(
    submit,
    /versionedSlotWhere\(slotRow\.event_id, submittedSlots, "reserved"\)/,
  );
  assert.doesNotMatch(
    submit,
    /expectedRowCondition\(\{ expectedCurrent: row \}\)/,
  );
});

test("大規模合作はJSON1一括INSERTでbind上限を回避する", () => {
  const limits = read("./atomicLimits.ts");
  const members =
    read("./replaceVideoMembers.ts");
  const memberSet =
    read("./memberSetSnapshot.ts");

  assert.match(
    limits,
    /MAX_VIDEO_MEMBERS = 100/,
  );
  assert.match(
    members,
    /buildVideoMemberBulkInsertSql/,
  );
  assert.match(
    memberSet,
    /FROM json_each\(\$\{payload\}\)/,
  );
  assert.doesNotMatch(
    members,
    /db\.insert\(videoMembers\)\.values\(nextMembers\)/,
  );
});

test("静的queueはjson_each UPSERTへ集約する", () => {
  const queue = read("../staticRebuild/enqueue.ts");
  assert.match(queue, /STATIC_REBUILD_BULK_UPSERT_ROWS = 10/);
  assert.match(queue, /FROM json_each\(\$\{payload\}\)/);
  assert.match(
    queue,
    /ON CONFLICT\(target_type, target_id\) WHERE status IN \('pending', 'processing'\)/,
  );
  assert.doesNotMatch(queue, /STATIC_REBUILD_BULK_UPDATE_ROWS/);
  assert.doesNotMatch(queue, /STATIC_REBUILD_BULK_INSERT_ROWS/);
});

test("作品保存は x_users プロフィール更新 plan を呼ばない", () => {
  for (const source of [create, submit, update]) {
    assert.doesNotMatch(source, /buildSubmissionXUserPlan/);
    assert.doesNotMatch(source, /ensureSubmissionXUser/);
  }
  assert.match(update, /creator_profile_text/);
  assert.match(update, /creator_other_social_links/);
});

test("メンバー更新は users_index を enqueue する", () => {
  assert.match(adminMembers, /targetType: "users_index"/);
  assert.match(adminMembers, /reason: "video_members_update"/);
  assert.match(update, /creatorAggregationChanged/);
  assert.match(update, /video_members_update/);
});

test("投稿候補はvideos snapshotから導出し候補履歴を二重書込みしない", () => {
  const combined = [create, submit, update].join("\n");
  assert.doesNotMatch(combined, /buildXIconCandidatePlan/);
  assert.doesNotMatch(combined, /buildYoutubeChannelCandidatePlan/);
});

test("FormData parserとUIはatomic上限の共通定数を使う", () => {
  const memberParser = read("./memberInputs.ts");
  const videoSchema = read("./videoFormSchema.ts");
  const videoForm = read("../../components/forms/VideoForm.tsx");
  const memberForm = read("../../components/forms/VideoMembersField.tsx");
  assert.match(
    memberParser,
    /\.max\(\s*MAX_VIDEO_MEMBERS/,
  );

  assert.match(
    videoSchema,
    /normalizeSoftwareLabels\(value\)\.length <= MAX_ATOMIC_VIDEO_SOFTWARES/,
  );
  assert.match(videoForm, /selectedEventIds\.length >= MAX_ATOMIC_VIDEO_EVENTS/);
  assert.match(videoForm, /最大\{MAX_ATOMIC_VIDEO_SOFTWARES\}件/);
  assert.match(
    memberForm,
    /normalizedRows\.length >= MAX_VIDEO_MEMBERS/,
  );
});

test("主要行の監査は投影ではなく完全なbefore/after rowを保持する", () => {
  assert.match(create, /after: \{ \.\.\.videoAfter \}/);
  assert.match(submit, /before: existingVideo \? \{ \.\.\.existingVideo \} : null/);
  assert.match(submit, /after: \{ \.\.\.videoAfter \}/);
  assert.match(update, /before: \{ \.\.\.plan\.target \}/);
  assert.match(update, /const after = \{ \.\.\.plan\.target, \.\.\.payload \}/);
});
