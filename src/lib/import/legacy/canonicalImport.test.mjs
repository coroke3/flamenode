import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { parseLegacyImportText } from "./parse.ts";
import { normalizeLegacyFiles, legacyImportAuthUserId } from "./normalize.ts";
import { planD1AuditMutationBudget } from "../../audit/mutateBudget.ts";
import {
  claimLegacyImportPreview,
  createLegacyImportPreview,
  LegacyImportPreviewError,
} from "./previewStore.ts";

const eventJson = JSON.stringify([
  {
    eventid: "pvsf-test",
    eventname: "PVSF Test",
    start: "2026-07-20 18:00",
    end: "2026-07-20 22:00",
    member: "Mochi,Staff",
    memberid: "mochi,staff_x",
    memberpost: "主催,運営",
  },
]);

const videoCsv = [
  "eventid,title,creator,tlink,ylink,member,memberid,starts,soft,data,time",
  "pvsf-test,作品A,Creator,creator_x,https://youtu.be/abcdefghijk,Creator,creator_x,0,After Effects,2026/07/20,19:00",
].join("\n");

const compatibilityEventJson = JSON.stringify([
  {
    eventid: "legacy-event-a",
    eventname: "Legacy Event A",
    start: "2026-03-27T18:00:00.000Z",
    end: "2026-03-29T23:59:00.000Z",
    type: "event",
    icon: "https://drive.google.com/open?id=fixture_a",
    img: "https://example.com/a.png",
    member: "Owner A",
    memberid: "owner_a",
    menberpost: "主催,余剰役割",
    explanation: "fixture",
  },
  {
    eventid: "legacy-event-b",
    eventname: "Legacy Event B",
    start: "2026-03-30T18:00:00.000Z",
    end: "",
    type: "collabo",
    icon: "",
    img: "",
    member: "Owner B",
    memberid: "owner_b",
    menberpost: "主催",
    explanation: "fixture",
  },
]);

const compatibilityVideoJson = JSON.stringify([
  {
    type2: "カテゴリ",
    type: "合作",
    creator: "Creator",
    yomi: "creator",
    tlink: "creator_x",
    ychlink: "https://www.youtube.com/@creator",
    icon: "https://example.com/icon.png",
    time: "2026-03-28T12:00:00.000Z",
    title: 2026,
    music: 0,
    credit: "credit",
    ymulink: "https://example.com/music",
    comment: "全体コメント",
    member: "Member A,Member B",
    memberid: "member_a,member_b",
    memberchapter: "0:00,0:20,0:40",
    ylink: "https://youtu.be/abcdefghijk",
    eventid: "legacy-event-a,legacy-event-b",
    beforecomment: "開始コメント",
    aftercomment: "終了コメント",
    soft: "Tool A,Tool B",
    toudan: "あり",
    hitokoto: "見どころ",
    toudan_question: "登壇回答",
  },
]);

function fixturePlan() {
  return normalizeLegacyFiles(
    [
      parseLegacyImportText("events.json", eventJson),
      parseLegacyImportText("videos.csv", videoCsv),
    ],
    {
      eventVisibility: "public",
      videoVisibility: "private",
      now: 1_700_000_000,
    },
  );
}

function compatibilityPlan(videoFieldDecisions = []) {
  return normalizeLegacyFiles(
    [
      parseLegacyImportText("eventinfo.json", compatibilityEventJson),
      parseLegacyImportText("video_new.json", compatibilityVideoJson),
    ],
    {
      eventVisibility: "public",
      videoVisibility: "private",
      videoFieldDecisions,
      now: 1_700_000_000,
    },
  );
}

class FakeR2Bucket {
  #objects = new Map();
  #version = 0;

  async put(key, body, options = {}) {
    const current = this.#objects.get(key);
    const expected = options.onlyIf?.etagMatches;
    if (expected && current?.etag !== expected) return null;
    const etag = `etag-${++this.#version}`;
    this.#objects.set(key, { body: String(body), etag });
    return { etag };
  }

  async get(key) {
    const current = this.#objects.get(key);
    if (!current) return null;
    return {
      etag: current.etag,
      text: async () => current.body,
    };
  }

  async delete(key) {
    this.#objects.delete(key);
  }
}

test("JSON/CSVを同じcanonical planへ変換する", () => {
  const plan = fixturePlan();
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0].visibility_status, "public");
  assert.equal(plan.eventStaff.filter((row) => row.permission_preset === "owner").length, 1);
  assert.equal(plan.videos.length, 1);
  assert.equal(plan.videos[0].youtube_video_id, "abcdefghijk");
  assert.equal(plan.videos[0].visibility_status, "private");
  assert.equal(plan.videoMembers.length, 1);
  assert.equal(plan.videoChapters.length, 1);
  assert.equal(plan.videoChapters[0].chapter_time, 0);
});

test("eventinfo.jsonとvideo_new.jsonの実形式を欠落なくplan化する", () => {
  const unresolved = compatibilityPlan();
  assert.deepEqual(unresolved.errors, []);
  assert.deepEqual(unresolved.unmappedVideoFields, [
    { source_key: "toudan_question", non_empty_rows: 1 },
  ]);
  assert.equal(unresolved.events.length, 2);
  assert.equal(unresolved.eventStaff.filter((row) => row.permission_preset === "owner").length, 2);
  assert.match(unresolved.warnings.join("\n"), /member\/memberid\/memberpost/);

  const plan = compatibilityPlan([
    {
      source_key: "toudan_question",
      action: "custom_question",
      question_label: "登壇について教えてください",
    },
  ]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.unmappedVideoFields, []);
  assert.equal(plan.videos.length, 1);
  assert.equal(plan.videos[0].title, "2026");
  assert.equal(plan.videos[0].music, "0");
  assert.equal(plan.videos[0].collaboration_type, "collab");
  assert.equal(plan.videos[0].intro_comment, "開始コメント");
  assert.match(plan.videos[0].production_story, /コメント: 全体コメント/);
  assert.equal(plan.videoChapters.length, 3);
  assert.deepEqual(plan.videoChapters.map((row) => row.x_user_id), [
    "member_a",
    "member_b",
    null,
  ]);
  assert.deepEqual(plan.videoChapters.map((row) => row.chapter_label), [
    "Member A",
    "Member B",
    "",
  ]);
  assert.equal(plan.eventCustomQuestions.length, 2);
  assert.equal(plan.videoCustomAnswers.length, 2);
  assert.equal(plan.videoCustomAnswers.every((row) => row.answer_text === "登壇回答"), true);
  assert.equal(
    plan.videoCustomAnswers.every((answer) =>
      plan.eventCustomQuestions.some(
        (question) =>
          question.id === answer.question_id &&
          question.event_id === answer.event_id &&
          question.question_key === answer.question_key,
      ),
    ),
    true,
  );
});

test("memberchapterは先頭から人物へ対応付けて不足側を空欄にする", () => {
  const eventFixture = JSON.stringify([
    {
      eventid: "chapter-event",
      eventname: "Chapter Event",
      member: "Owner",
      memberid: "owner",
      menberpost: "主催",
    },
  ]);
  const videoFixture = JSON.stringify([
    {
      title: "members-short",
      creator: "Creator",
      ylink: "https://youtu.be/abcdefghij1",
      eventid: "chapter-event",
      member: "Member A,Member B",
      memberid: "member_a,member_b",
      memberchapter: "0:00,0:10,0:20",
    },
    {
      title: "chapters-short",
      creator: "Creator",
      ylink: "https://youtu.be/abcdefghij2",
      eventid: "chapter-event",
      member: "Member A,Member B,Member C",
      memberid: "member_a,member_b,member_c",
      memberchapter: "0:00,0:10",
    },
  ]);
  const plan = normalizeLegacyFiles(
    [
      parseLegacyImportText("eventinfo.json", eventFixture),
      parseLegacyImportText("video_new.json", videoFixture),
    ],
    {
      eventVisibility: "public",
      videoVisibility: "private",
      now: 1_700_000_000,
    },
  );

  assert.deepEqual(plan.errors, []);
  const membersShort = plan.videos.find((video) => video.title === "members-short");
  const chaptersShort = plan.videos.find((video) => video.title === "chapters-short");
  assert.ok(membersShort);
  assert.ok(chaptersShort);
  assert.deepEqual(
    plan.videoChapters
      .filter((chapter) => chapter.video_id === membersShort.id)
      .map((chapter) => [chapter.x_user_id, chapter.chapter_label]),
    [
      ["member_a", "Member A"],
      ["member_b", "Member B"],
      [null, ""],
    ],
  );
  assert.equal(
    plan.videoMembers.filter((member) => member.video_id === chaptersShort.id).length,
    3,
  );
  assert.deepEqual(
    plan.videoChapters
      .filter((chapter) => chapter.video_id === chaptersShort.id)
      .map((chapter) => [chapter.x_user_id, chapter.chapter_label]),
    [
      ["member_a", "Member A"],
      ["member_b", "Member B"],
    ],
  );
  assert.match(plan.warnings.join("\n"), /足りない側は空欄/);
});

test("未対応動画項目は既定で無視してpreview可能にする", () => {
  const plan = compatibilityPlan();
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.unmappedVideoFields, [
    { source_key: "toudan_question", non_empty_rows: 1 },
  ]);
  assert.equal(plan.eventCustomQuestions.length, 0);
  assert.equal(plan.videoCustomAnswers.length, 0);
  assert.match(plan.warnings.join("\n"), /取り込み対象外/);
});

test("未対応動画項目は明示ignoreでもpreview可能にする", () => {
  const plan = compatibilityPlan([
    { source_key: "toudan_question", action: "ignore" },
  ]);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.unmappedVideoFields, []);
  assert.equal(plan.eventCustomQuestions.length, 0);
  assert.equal(plan.videoCustomAnswers.length, 0);
  assert.match(plan.warnings.join("\n"), /指定どおり取り込み対象外/);
  assert.deepEqual(plan.videoFieldDecisions, [
    { source_key: "toudan_question", action: "ignore" },
  ]);
});

test("正規カラムや過剰なカスタム回答割当をfail closedにする", () => {
  const reserved = compatibilityPlan([
    { source_key: "title", action: "custom_question", question_label: "タイトル" },
  ]);
  assert.match(reserved.errors.join("\n"), /正規カラムへ変換/);

  const rows = JSON.parse(compatibilityVideoJson);
  rows[0].eventid = "legacy-event-a,legacy-event-b,legacy-event-c";
  rows[0].legacy_extra = "extra";
  const thirdEvent = {
    ...JSON.parse(compatibilityEventJson)[0],
    eventid: "legacy-event-c",
    eventname: "Legacy Event C",
    memberid: "owner_c",
  };
  const plan = normalizeLegacyFiles(
    [
      parseLegacyImportText(
        "eventinfo.json",
        JSON.stringify([...JSON.parse(compatibilityEventJson), thirdEvent]),
      ),
      parseLegacyImportText("video_new.json", JSON.stringify(rows)),
    ],
    {
      eventVisibility: "public",
      videoVisibility: "private",
      videoFieldDecisions: [
        { source_key: "toudan_question", action: "custom_question", question_label: "Q1" },
        { source_key: "legacy_extra", action: "custom_question", question_label: "Q2" },
      ],
      now: 1_700_000_000,
    },
  );
  assert.match(plan.errors.join("\n"), /イベント別の複製を含めて最大4件/);
});

test("TSVと引用符付きCSVを解析できる", () => {
  const tsv = "eventid\teventname\tmember\tmemberid\nfoo\tFoo Event\tMochi\tmochi\n";
  const parsedTsv = parseLegacyImportText("events.tsv", tsv);
  assert.equal(parsedTsv.rows[0].eventname, "Foo Event");

  const quoted = 'title,creator,tlink,credit\n"作品, A",Creator,creator_x,"line1\nline2"\n';
  const parsedCsv = parseLegacyImportText("videos.csv", quoted);
  assert.equal(parsedCsv.rows[0].title, "作品, A");
  assert.equal(parsedCsv.rows[0].credit, "line1\nline2");
});

test("Discord未連携X名義向けの認証ユーザーIDは安定する", () => {
  assert.equal(legacyImportAuthUserId("creator_x"), legacyImportAuthUserId("creator_x"));
  assert.notEqual(legacyImportAuthUserId("creator_x"), legacyImportAuthUserId("member_a"));
});

test("旧DB列をcanonical planへ残さない", () => {
  const serialized = JSON.stringify(fixturePlan());
  for (const forbidden of [
    "linked_user_id",
    "representative_x_user_id",
    "chapters_json",
    "slot_kind",
    "priority_reclaim_until",
    "video_youtube_metadata.youtube_video_id",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("R2へ保存した同一planだけを一回限りclaimできる", async () => {
  const bucket = new FakeR2Bucket();
  const previewToken = "a".repeat(32);
  const credential = await createLegacyImportPreview(
    bucket,
    {
      authUserId: "auth-user-1",
      strategy: "create_only",
      plan: fixturePlan(),
    },
    { now: 1_000, previewToken },
  );
  assert.equal(credential.previewToken, previewToken);
  assert.match(credential.planHash, /^[a-f0-9]{64}$/);
  assert.equal(credential.expiresAt, 1_900);

  await assert.rejects(
    claimLegacyImportPreview(
      bucket,
      {
        authUserId: "auth-user-1",
        previewToken,
        planHash: "0".repeat(64),
      },
      { now: 1_001 },
    ),
    (error) => error instanceof LegacyImportPreviewError && error.code === "hash_mismatch",
  );

  const first = await claimLegacyImportPreview(
    bucket,
    {
      authUserId: "auth-user-1",
      previewToken,
      planHash: credential.planHash,
    },
    { now: 1_002, claimId: "b".repeat(32) },
  );
  assert.equal(first.attempt, 1);
  assert.equal(first.strategy, "create_only");

  await assert.rejects(
    claimLegacyImportPreview(
      bucket,
      {
        authUserId: "auth-user-1",
        previewToken,
        planHash: credential.planHash,
      },
      { now: 1_003 },
    ),
    (error) => error instanceof LegacyImportPreviewError && error.code === "already_claimed",
  );

  await first.release();
  let claimed = await claimLegacyImportPreview(
    bucket,
    {
      authUserId: "auth-user-1",
      previewToken,
      planHash: credential.planHash,
    },
    { now: 1_004, claimId: "c".repeat(32) },
  );
  assert.equal(claimed.attempt, 2);

  let stepNow = 1_010;
  while (claimed.progress.stage !== "complete") {
    const progress = claimed.progress;
    const plan = claimed.plan;
    const next = {
      ...progress,
      counts: { ...progress.counts },
      skipExistingEventIds: [...progress.skipExistingEventIds],
      skipExistingVideoIds: [...progress.skipExistingVideoIds],
    };
    if (progress.stage === "system_user") {
      next.stage = "x_users";
      next.index = 0;
    } else if (progress.stage === "x_users") {
      const groupCount = Math.max(1, Math.ceil(Math.max(plan.xUsers.length, 1) / 40));
      if (progress.index + 1 < groupCount) next.index += 1;
      else {
        next.stage = "softwares";
        next.index = 0;
      }
    } else if (progress.stage === "softwares") {
      next.stage = "events";
      next.index = 0;
    } else if (progress.stage === "events") {
      next.counts.createdEvents += plan.events.length ? 1 : 0;
      next.stage = "custom_questions";
      next.index = 0;
    } else if (progress.stage === "custom_questions") {
      next.stage = "videos";
      next.index = 0;
    } else if (progress.stage === "videos") {
      next.counts.createdVideos += plan.videos.length ? 1 : 0;
      next.stage = "complete";
      next.index = 0;
    } else {
      throw new Error(`unexpected stage: ${progress.stage}`);
    }
    await claimed.advance(next);
    if (next.stage === "complete") break;
    stepNow += 1;
    claimed = await claimLegacyImportPreview(
      bucket,
      {
        authUserId: "auth-user-1",
        previewToken,
        planHash: credential.planHash,
      },
      {
        now: stepNow,
        claimId: `${String(stepNow).padStart(8, "0")}${"d".repeat(24)}`,
      },
    );
  }

  const finished = await claimLegacyImportPreview(
    bucket,
    {
      authUserId: "auth-user-1",
      previewToken,
      planHash: credential.planHash,
    },
    { now: 1_100 },
  );
  assert.equal(finished.completed, true);
  assert.equal(finished.progress.stage, "complete");
});

test("期限切れpreview planを削除して拒否する", async () => {
  const bucket = new FakeR2Bucket();
  const credential = await createLegacyImportPreview(
    bucket,
    {
      authUserId: "auth-user-expired",
      strategy: "skip_existing",
      plan: fixturePlan(),
    },
    { now: 100, previewToken: "d".repeat(32) },
  );
  await assert.rejects(
    claimLegacyImportPreview(
      bucket,
      {
        authUserId: "auth-user-expired",
        previewToken: credential.previewToken,
        planHash: credential.planHash,
      },
      { now: 1_000 },
    ),
    (error) => error instanceof LegacyImportPreviewError && error.code === "expired",
  );
});

test("apply時にファイルを再解析せずR2保存planを使用する", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const route = fs.readFileSync(path.join(root, "app/api/admin/import/legacy/route.ts"), "utf8");
  const client = fs.readFileSync(path.join(root, "src/components/admin/LegacyCanonicalImportClient.tsx"), "utf8");
  assert.ok(route.indexOf('mode === "apply"') < route.indexOf('formData.getAll("files")'));
  assert.match(route, /claimLegacyImportPreview/);
  assert.match(route, /createLegacyImportPreview/);
  assert.doesNotMatch(route, /fingerprintLegacyImport|verifyLegacyImportPreviewToken/);
  assert.match(client, /selectedFiles/);
  assert.match(client, /body\.append\("files", file\)/);
  assert.match(client, /plan_hash/);
  assert.match(client, /video_custom_field_decisions/);
  assert.match(client, /data-legacy-field-mapping/);
  assert.match(client, /syncFieldCandidatesFromResponse/);
  assert.match(client, /formUnchanged[\s\S]*?syncFieldCandidatesFromResponse\(json\)/);
  assert.match(client, /戦略・公開設定の変更でもカスタム質問の下書きは残す/);
  assert.match(client, /candidates\.length === 0[\s\S]*?setFieldDecisionDrafts\(new Map\(\)\)/);
  assert.match(client, /customQuestions[\s\S]*?customAnswers[\s\S]*?プレビュー plan に含めました/);
  assert.doesNotMatch(route, /requires_field_mapping.*422/);
  assert.match(route, /video_custom_field_candidates: plan\.unmappedVideoFields/);
  assert.match(route, /LEGACY_IMPORT_PLAN_WARN_BYTES/);
  assert.match(route, /estimateLegacyImportStoredPlanBytes/);
  const rowCountGuard = route.indexOf("rowCount > MAX_ROWS");
  const normalizeCall = route.indexOf("normalizeLegacyFiles(parsed");
  assert.ok(rowCountGuard > 0 && normalizeCall > 0 && rowCountGuard < normalizeCall);
});

test("カスタム質問・回答applyは手動回答保護とD1予算を維持する", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const apply = fs.readFileSync(path.join(root, "src/lib/import/legacy/apply.ts"), "utf8");
  const preflight = fs.readFileSync(path.join(root, "src/lib/import/legacy/preflight.ts"), "utf8");
  const previewStore = fs.readFileSync(path.join(root, "src/lib/import/legacy/previewStore.ts"), "utf8");
  assert.match(apply, /eventCustomQuestions/);
  assert.match(apply, /videoCustomAnswers/);
  assert.match(apply, /LEGACY_CUSTOM_ANSWER_AUDIT_CONTEXT/);
  assert.match(apply, /current\.updated_at = json_extract\(incoming\.value, '\$\.updated_at'\)/);
  assert.match(apply, /expectedRowCondition\(\{ expectedCurrent: before \}\)/);
  assert.match(apply, /legacy_import_question_snapshot_mismatch/);
  assert.match(apply, /legacy_import_custom_answer_snapshot_mismatch/);
  assert.match(apply, /applyLegacyImportPlanStep/);
  assert.match(preflight, /MAX_EVENT_CUSTOM_QUESTIONS = 18/);
  assert.match(preflight, /MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO/);
  assert.match(preflight, /旧形式インポート由来と確認できないため置換できません/);
  assert.match(apply, /ensureImportedAuthUsers/);
  assert.match(apply, /legacyImportAuthUserId/);
  assert.match(apply, /x_user_account_links_import_batch/);
  assert.match(previewStore, /PREVIEW_VERSION = 3 as const/);
  assert.match(previewStore, /status: "completed"/);

  const budget = planD1AuditMutationBudget({
    mutationStatementCount: 15,
    mutationAssertionCount: 13,
    auditEntryCount: 5,
    distinctActorCount: 1,
  });
  assert.equal(budget.totalQueryCount, 44);
  assert.equal(budget.withinLimit, true);
});

test("ランタイム側に旧テーブル・dual-writeを導入しない", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const files = [
    "src/lib/import/legacy/apply.ts",
    "app/api/admin/import/legacy/route.ts",
    "src/lib/import/legacy/previewStore.ts",
  ];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  for (const forbidden of [
    "x_account_link_requests",
    "x_id_merge_requests",
    "x_id_merge_reverts",
    "x_users.linked_user_id",
    "video_members.chapters_json",
    "legacy_import_batches",
    "legacy_import_batch_items",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("X ID統合は承認申請だけを入口にし、直接Actionを残さない", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  assert.equal(fs.existsSync(path.join(root, "src/lib/actions/merge-admin.ts")), false);
  assert.equal(fs.existsSync(path.join(root, "src/components/admin/MergeRequestButton.tsx")), false);
  const mergeSource = fs.readFileSync(path.join(root, "src/lib/xid/merge.ts"), "utf8");
  assert.match(mergeSource, /executeApprovedXIdMergeRequest/);
  assert.match(mergeSource, /UPDATE x_identity_requests/);
  assert.match(mergeSource, /SET active_x_user_id = \$\{target\}/);
  assert.match(mergeSource, /approval_status = 'rejected'/);
});
