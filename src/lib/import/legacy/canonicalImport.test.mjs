import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { parseLegacyImportText } from "./parse.ts";
import { selectLegacyParsedFileRange, suggestLegacyImportRowRanges, findLegacyImportRangeIndex, nextLegacyImportRowRange, legacyImportRangeChunkKey } from "./range.ts";
import {
  legacyImportCpuBudgetErrors,
  MAX_LEGACY_IMPORT_SELECTED_ROWS,
} from "./cpuBudget.ts";
import { normalizeLegacyFiles, legacyImportAuthUserId, isLegacyImportPlaceholderAuthUserId } from "./normalize.ts";
import { planD1AuditMutationBudget } from "../../audit/mutateBudget.ts";
import {
  claimLegacyImportPreview,
  createLegacyImportPreview,
  LegacyImportPreviewError,
} from "./previewStore.ts";
import { legacyImportRebuildQueueId } from "./rebuildQueueCore.ts";

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

test("video_new.jsonのみでも参照eventidからイベントを自動作成する", () => {
  const videoOnlyJson = JSON.stringify([
    {
      title: "作品のみ",
      creator: "Creator",
      tlink: "creator_x",
      ylink: "https://youtu.be/abcdefghijk",
      eventid: "orphan-event",
    },
    {
      title: "メンバーからowner",
      creator: "NoX",
      ylink: "https://youtu.be/abcdefghij2",
      eventid: "member-owner-event",
      member: "Member",
      memberid: "member_x",
    },
    {
      title: "placeholder owner",
      creator: "NoX",
      ylink: "https://youtu.be/abcdefghij3",
      eventid: "placeholder-owner-event",
    },
  ]);
  const plan = normalizeLegacyFiles(
    [parseLegacyImportText("video_new.json", videoOnlyJson)],
    {
      eventVisibility: "public",
      videoVisibility: "private",
      now: 1_700_000_000,
    },
  );

  assert.deepEqual(plan.errors, []);
  assert.equal(plan.events.length, 3);
  assert.equal(plan.eventStaff.filter((row) => row.permission_preset === "owner").length, 3);
  assert.equal(plan.videos.length, 3);

  const creatorEvent = plan.events.find((event) => event.id === "orphan-event");
  assert.ok(creatorEvent);
  assert.equal(creatorEvent.title, "orphan-event");
  assert.equal(creatorEvent.event_type, "event");
  assert.match(creatorEvent.explanation, /自動作成/);
  assert.equal(creatorEvent.visibility_status, "public");
  assert.equal(
    plan.eventStaff.find(
      (staff) => staff.event_id === "orphan-event" && staff.permission_preset === "owner",
    )?.x_user_id,
    "creator_x",
  );

  assert.equal(
    plan.eventStaff.find(
      (staff) =>
        staff.event_id === "member-owner-event" && staff.permission_preset === "owner",
    )?.x_user_id,
    "member_x",
  );

  const placeholderOwner = plan.eventStaff.find(
    (staff) =>
      staff.event_id === "placeholder-owner-event" && staff.permission_preset === "owner",
  );
  assert.ok(placeholderOwner);
  assert.match(placeholderOwner.x_user_id, /^[a-z0-9_]{1,20}$/);
  assert.ok(plan.xUsers.some((user) => user.id === placeholderOwner.x_user_id));

  assert.match(plan.warnings.join("\n"), /イベント orphan-event は動画参照のため自動作成します/);
  assert.match(plan.warnings.join("\n"), /イベント member-owner-event は動画参照のため自動作成します/);
});

test("eventinfoで定義済みイベントは自動作成で上書きしない", () => {
  const plan = compatibilityPlan();
  const eventA = plan.events.find((event) => event.id === "legacy-event-a");
  assert.ok(eventA);
  assert.equal(eventA.title, "Legacy Event A");
  assert.equal(eventA.explanation, "fixture");
  assert.equal(
    plan.eventStaff.find(
      (staff) => staff.event_id === "legacy-event-a" && staff.permission_preset === "owner",
    )?.x_user_id,
    "owner_a",
  );
  assert.doesNotMatch(plan.warnings.join("\n"), /イベント legacy-event-a は動画参照のため自動作成します/);
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

test("Discord未連携X名義向けの決定的auth user idヘルパーは残すがimportでは使わない", () => {
  assert.equal(legacyImportAuthUserId("creator_x"), legacyImportAuthUserId("creator_x"));
  assert.notEqual(legacyImportAuthUserId("creator_x"), legacyImportAuthUserId("member_a"));
  assert.equal(isLegacyImportPlaceholderAuthUserId(legacyImportAuthUserId("creator_x")), true);
  assert.equal(isLegacyImportPlaceholderAuthUserId("system_legacy_import"), false);
  assert.equal(isLegacyImportPlaceholderAuthUserId("usr_imp_deadbeef"), true);
  assert.equal(isLegacyImportPlaceholderAuthUserId("usr_imp_notahex1"), false);
  const root = path.resolve(import.meta.dirname, "../../../..");
  const apply = fs.readFileSync(path.join(root, "src/lib/import/legacy/apply.ts"), "utf8");
  assert.doesNotMatch(apply, /legacyImportAuthUserId/);
  assert.doesNotMatch(apply, /ensureImportedAuthUsers/);
});

test("admin users Discordタブはdiscord_idがある認証ユーザーだけを表示する", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const page = fs.readFileSync(path.join(root, "app/(admin)/admin/users/page.tsx"), "utf8");
  assert.match(page, /isNotNull\(usersTable\.discord_id\)/);
  assert.match(page, /discordPrincipalFilter/);
  assert.match(page, /空discord_idプレースホルダーはX IDタブ側/);
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

test("応答断で残ったclaimは1分後に同じpreviewから再開できる", async () => {
  const bucket = new FakeR2Bucket();
  const credential = await createLegacyImportPreview(
    bucket,
    {
      authUserId: "auth-user-recover",
      strategy: "skip_existing",
      plan: fixturePlan(),
    },
    { now: 2_000, previewToken: "e".repeat(32) },
  );
  const abandoned = await claimLegacyImportPreview(
    bucket,
    {
      authUserId: "auth-user-recover",
      previewToken: credential.previewToken,
      planHash: credential.planHash,
    },
    { now: 2_001, claimId: "f".repeat(32) },
  );
  assert.equal(abandoned.attempt, 1);

  await assert.rejects(
    claimLegacyImportPreview(
      bucket,
      {
        authUserId: "auth-user-recover",
        previewToken: credential.previewToken,
        planHash: credential.planHash,
      },
      { now: 2_060, claimId: "1".repeat(32) },
    ),
    (error) => error instanceof LegacyImportPreviewError && error.code === "already_claimed",
  );

  const resumed = await claimLegacyImportPreview(
    bucket,
    {
      authUserId: "auth-user-recover",
      previewToken: credential.previewToken,
      planHash: credential.planHash,
    },
    { now: 2_061, claimId: "2".repeat(32) },
  );
  assert.equal(resumed.attempt, 2);
  assert.deepEqual(resumed.progress, abandoned.progress);
});

test("512KBを超えるpreview planはR2へ保存せず拒否する", async () => {
  const plan = fixturePlan();
  await assert.rejects(
    createLegacyImportPreview(
      new FakeR2Bucket(),
      {
        authUserId: "auth-user-large-plan",
        strategy: "skip_existing",
        plan: { ...plan, warnings: ["x".repeat(600 * 1024)] },
      },
      { now: 3_000, previewToken: "3".repeat(32) },
    ),
    (error) => error instanceof LegacyImportPreviewError && error.code === "plan_too_large",
  );
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
  assert.match(apply, /ensureXUserGroup/);
  assert.doesNotMatch(apply, /ensureImportedAuthUsers/);
  assert.doesNotMatch(apply, /user_import_batch/);
  assert.doesNotMatch(apply, /x_user_account_links_import_batch/);
  assert.match(apply, /createdAuthUsers: 0/);
  assert.match(previewStore, /PREVIEW_VERSION = 4 as const/);
  assert.match(previewStore, /status: "completed"/);

  const budget = planD1AuditMutationBudget({
    mutationStatementCount: 15,
    mutationAssertionCount: 14,
    auditEntryCount: 5,
    distinctActorCount: 1,
  });
  assert.equal(budget.totalQueryCount, 45);
  assert.equal(budget.withinLimit, true);
});

test("ファイルごとの1始まり・終了含む範囲を選択し、元行位置を維持する", () => {
  const parsed = parseLegacyImportText(
    "videos.json",
    JSON.stringify([
      { title: "A" },
      { title: "B" },
      { title: "C" },
      { title: "D" },
    ]),
  );
  const ranged = selectLegacyParsedFileRange(parsed, { start: "2", end: "3" });
  assert.deepEqual(ranged.file.rows.map((row) => row.title), ["B", "C"]);
  assert.equal(ranged.file.rowOffset, 1);
  assert.deepEqual(ranged.range, {
    fileName: "videos.json",
    sourceRows: 4,
    startRow: 2,
    endRow: 3,
    selectedRows: 2,
  });

  const all = selectLegacyParsedFileRange(parsed, { start: "", end: "" });
  assert.equal(all.range.selectedRows, 4);
  assert.equal(all.file.rowOffset, 0);
});

test("不正またはファイル外の読み込み範囲をfail closedで拒否する", () => {
  const parsed = parseLegacyImportText("rows.json", JSON.stringify([{ id: 1 }, { id: 2 }]));
  assert.throws(
    () => selectLegacyParsedFileRange(parsed, { start: "0", end: "1" }),
    /開始位置は1以上の整数/,
  );
  assert.throws(
    () => selectLegacyParsedFileRange(parsed, { start: "2", end: "1" }),
    /終了位置は開始位置以上/,
  );
  assert.throws(
    () => selectLegacyParsedFileRange(parsed, { start: "1", end: "3" }),
    /データ件数 2 を超えています/,
  );
});

test("suggestLegacyImportRowRangesは1始まりの非重複範囲へtotalRowsを分割する", () => {
  assert.deepEqual(suggestLegacyImportRowRanges(0), []);
  assert.deepEqual(suggestLegacyImportRowRanges(-1), []);
  assert.deepEqual(suggestLegacyImportRowRanges(10, 0), []);
  assert.deepEqual(suggestLegacyImportRowRanges(1), [{ startRow: 1, endRow: 1 }]);
  assert.deepEqual(suggestLegacyImportRowRanges(250), [{ startRow: 1, endRow: 250 }]);
  assert.deepEqual(suggestLegacyImportRowRanges(251), [
    { startRow: 1, endRow: 250 },
    { startRow: 251, endRow: 251 },
  ]);
  assert.deepEqual(suggestLegacyImportRowRanges(500), [
    { startRow: 1, endRow: 250 },
    { startRow: 251, endRow: 500 },
  ]);
  assert.deepEqual(suggestLegacyImportRowRanges(501, 100), [
    { startRow: 1, endRow: 100 },
    { startRow: 101, endRow: 200 },
    { startRow: 201, endRow: 300 },
    { startRow: 301, endRow: 400 },
    { startRow: 401, endRow: 500 },
    { startRow: 501, endRow: 501 },
  ]);
});

test("findLegacyImportRangeIndexは完全一致のみを返し、不正入力は-1", () => {
  const ranges = suggestLegacyImportRowRanges(500);
  assert.equal(findLegacyImportRangeIndex(ranges, 1, 250), 0);
  assert.equal(findLegacyImportRangeIndex(ranges, 251, 500), 1);
  assert.equal(findLegacyImportRangeIndex(ranges, 1, 500), -1);
  assert.equal(findLegacyImportRangeIndex(ranges, 2, 250), -1);
  assert.equal(findLegacyImportRangeIndex([], 1, 1), -1);
  assert.equal(findLegacyImportRangeIndex(ranges, 0, 250), -1);
  assert.equal(findLegacyImportRangeIndex(ranges, 1, 0), -1);
});

test("nextLegacyImportRowRangeは現在範囲の次、未一致時はstartRowより後を返す", () => {
  const ranges = suggestLegacyImportRowRanges(500);
  assert.deepEqual(nextLegacyImportRowRange(ranges, 1, 250), { startRow: 251, endRow: 500 });
  assert.equal(nextLegacyImportRowRange(ranges, 251, 500), null);
  assert.deepEqual(nextLegacyImportRowRange(ranges, 99, 120), { startRow: 251, endRow: 500 });
  assert.equal(nextLegacyImportRowRange([], 1, 250), null);
  assert.equal(nextLegacyImportRowRange(ranges, 0, 250), null);
  assert.equal(legacyImportRangeChunkKey(1, 250), "1-250");
});

test("legacy import UIは順次チャンク入力と完了追跡を持つ", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const client = fs.readFileSync(path.join(root, "src/components/admin/LegacyCanonicalImportClient.tsx"), "utf8");
  assert.match(client, /次のチャンクを入力/);
  assert.match(client, /completedChunkKeysByFile/);
  assert.match(client, /markChunkApplyComplete/);
  assert.match(client, /chunkCompleteBanner/);
  assert.match(client, /チャンク完了。次は/);
  assert.match(client, /次の範囲を入力して再プレビュー/);
  assert.match(client, /各チャンクの apply 完了を確認してから次の範囲を preview/);
  assert.match(client, /findNextIncompleteLegacyImportRange/);
  assert.match(client, /legacyImportRangeChunkKey/);
  assert.match(client, /LEGACY_IMPORT_CHUNK_SIZE_OPTIONS/);
  assert.match(client, /setChunkSizeOption/);
  assert.match(client, /suggestLegacyImportRowRanges\(sourceRows, chunkSize\)/);
  assert.match(client, /提案チャンクサイズ/);
  assert.match(client, /このあと残り/);
  assert.match(client, /範囲未指定時は全/);
  assert.match(client, /const nextCompleted = new Map\(completedChunkKeysByFile\)/);
  const markStart = client.indexOf("const markChunkApplyComplete");
  const markEnd = client.indexOf("function setChunkSizeOption", markStart);
  const markBody = client.slice(markStart, markEnd);
  assert.match(markBody, /setCompletedChunkKeysByFile\(nextCompleted\)/);
  assert.match(markBody, /setChunkCompleteBanner\(nextBanner\)/);
  assert.doesNotMatch(markBody, /setCompletedChunkKeysByFile\(\(current\)\s*=>/);
  const submitStart = client.indexOf("async function submit");
  const submitEnd = client.indexOf("  const expiresLabel", submitStart);
  const submitBody = client.slice(submitStart, submitEnd);
  assert.doesNotMatch(submitBody, /applyNextIncompleteChunk/);
  assert.doesNotMatch(submitBody, /markChunkApplyComplete[\s\S]*void submit\(/);
});

test("1原子stepの関連件数をCloudflare CPU予算内へ固定する", () => {
  const plan = fixturePlan();
  assert.deepEqual(legacyImportCpuBudgetErrors(plan), []);

  const chapter = plan.videoChapters[0];
  const oversized = {
    ...plan,
    videoChapters: Array.from({ length: 129 }, (_, index) => ({
      ...chapter,
      id: `${chapter.id}-${index}`,
      chapter_time: index,
    })),
  };
  assert.match(legacyImportCpuBudgetErrors(oversized).join("\n"), /チャプターは1回の取込で最大128件/);
  assert.equal(MAX_LEGACY_IMPORT_SELECTED_ROWS, 250);
});

test("旧形式applyは公開R2 JSONの全関連targetを原子的に再生成予約する", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const apply = fs.readFileSync(path.join(root, "src/lib/import/legacy/apply.ts"), "utf8");
  for (const targetType of [
    "event",
    "events_index",
    "video",
    "top",
    "list_recent",
    "list_popular",
    "search_index",
    "user",
  ]) {
    assert.match(apply, new RegExp(`targetType: "${targetType}"`), targetType);
  }
  assert.match(apply, /legacyRebuildQueueMutation/);
  assert.match(apply, /ON CONFLICT\(target_type, target_id\) WHERE status IN \('pending', 'processing'\)/);
  assert.match(apply, /updated_at = MAX\(static_rebuild_queue\.updated_at \+ 1, excluded\.updated_at\)/);
  assert.match(apply, /rebuildQueue\.statement/);
  assert.match(apply, /rebuildQueue\.expectedChanges/);
  assert.match(apply, /stepTargetId: identity\.targetId/);
  assert.match(apply, /legacyImportRebuildQueueId\(options\.stepTargetId, index\)/);
  assert.doesNotMatch(apply, /legacy_import_video_\$\{options\.runDigest/);

  const plan = "a".repeat(24);
  const hash = "b".repeat(24);
  const firstStepIds = new Set([
    legacyImportRebuildQueueId(`${plan}:${hash}:videos:0`, 0),
    legacyImportRebuildQueueId(`${plan}:${hash}:videos:0`, 1),
  ]);
  const secondStepIds = [
    legacyImportRebuildQueueId(`${plan}:${hash}:videos:1`, 0),
    legacyImportRebuildQueueId(`${plan}:${hash}:videos:1`, 1),
  ];
  assert.equal(firstStepIds.size, 2);
  assert.equal(secondStepIds.every((id) => !firstStepIds.has(id)), true);
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

test("applyクライアントは423/503を短時間だけ再試行し、previewを保持して停止する", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const client = fs.readFileSync(path.join(root, "src/components/admin/LegacyCanonicalImportClient.tsx"), "utf8");
  assert.match(client, /readApiResponse/);
  assert.match(client, /isApplyTransientFailure/);
  assert.match(client, /json\.retryable === true/);
  assert.match(client, /response\.status === 423/);
  assert.match(client, /response\.status === 503/);
  assert.match(client, /APPLY_TRANSIENT_MAX_RETRIES = 4/);
  assert.match(client, /APPLY_MAX_REQUESTS_PER_RUN_DEFAULT = 500/);
  assert.match(client, /APPLY_MAX_REQUESTS_PER_RUN_OPTIONS = \[100, 250, 500\]/);
  assert.match(client, /APPLY_STEP_PAUSE_HEALTHY_MS = 40/);
  assert.match(client, /function applyStepPauseMs/);
  assert.match(client, /applyTransientBackoffMs/);
  assert.match(client, /5_000/);
  assert.match(client, /retryStoppedMessage/);
  assert.match(client, /自動再試行は.*回で停止しました/);
  assert.match(client, /flamenode:legacy-import:credential:v4/);
  assert.match(client, /sessionStorage/);
  assert.match(client, /自動再試行中/);
  assert.match(client, /サーバーが一時的に応答できませんでした/);
  assert.match(client, /mode === "preview"[\s\S]*?isApplyTransientFailure/);
  assert.match(client, /json\.requires_repreview[\s\S]*?setCredential\(null\)/);
  assert.match(client, /committed_progress_pending/);
  assert.match(client, /ステップ保存済み（進捗復旧中）/);
  assert.match(client, /transientFailures = 0/);
  assert.match(client, /await sleep\(applyStepPauseMs\(successStreak\)\)/);
  assert.match(client, /1ランの最大ステップ数/);
  assert.match(client, /applyRunProgress/);
  assert.match(client, /completedSteps/);
  assert.match(client, /一時エラーの再試行はラン上限に含めない/);
  assert.match(client, /lastPreviewFileRanges/);
  assert.match(client, /startRow > endRow \|\| startRow > sourceRows \|\| endRow > sourceRows/);
  assert.match(client, /行数を推定できませんでした/);
  assert.match(client, /範囲が不正です/);
  assert.match(client, /未完了のプレビューがあります/);
  assert.match(client, /無料枠と連続負荷を守るため一時停止しました/);
});

test("apply routeはCloudflare上限のため1リクエスト1原子ステップに限定する", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const route = fs.readFileSync(path.join(root, "app/api/admin/import/legacy/route.ts"), "utf8");
  const previewStore = fs.readFileSync(path.join(root, "src/lib/import/legacy/previewStore.ts"), "utf8");
  assert.match(route, /1 HTTP リクエストでは原子ステップを1件だけ確定する/);
  assert.match(route, /const step = await applyLegacyImportPlanStep/);
  assert.match(route, /const expiresAt = await claimed\.advance\(step\.progress\)/);
  assert.match(route, /continuation_required: !step\.complete/);
  assert.doesNotMatch(route, /APPLY_MAX_STEPS_PER_REQUEST|claimed\.checkpoint|while \(/);
  assert.doesNotMatch(previewStore, /checkpoint:/);
  assert.match(previewStore, /PREVIEW_MAX_LIFETIME_SECONDS = 6 \* 60 \* 60/);
  assert.match(previewStore, /LEGACY_IMPORT_PREVIEW_MAX_LIFETIME_SECONDS/);
  assert.match(previewStore, /previewExpiresAt/);
  assert.match(previewStore, /CLAIM_TTL_SECONDS = 60/);
  assert.doesNotMatch(previewStore, /createdAt \+ 2 \* 60 \* 60/);
});

test("preview routeとUIはファイルごとの範囲をplanへ固定する", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const route = fs.readFileSync(path.join(root, "app/api/admin/import/legacy/route.ts"), "utf8");
  const client = fs.readFileSync(path.join(root, "src/components/admin/LegacyCanonicalImportClient.tsx"), "utf8");
  assert.match(route, /selectLegacyParsedFileRange/);
  assert.match(route, /range_start_\$\{fileIndex\}/);
  assert.match(route, /range_end_\$\{fileIndex\}/);
  assert.match(route, /file_ranges: fileRanges/);
  assert.ok(route.indexOf("const ranged = selectLegacyParsedFileRange") < route.indexOf("rowCount > MAX_ROWS"));
  assert.match(client, /name=\{`range_start_\$\{index\}`\}/);
  assert.match(client, /name=\{`range_end_\$\{index\}`\}/);
  assert.match(client, /今回の読み込み範囲/);
  assert.match(client, /同じ大きなファイルを複数回に分ける場合/);
  assert.match(client, /suggestLegacyImportRowRanges/);
  assert.match(client, /MAX_LEGACY_IMPORT_SELECTED_ROWS/);
  assert.match(client, /先頭\{chunkSize\}行を入力/);
  assert.match(client, /この範囲を入力/);
});

test("apply routeは各ステップ適用前にCPU予算を再検査する", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const route = fs.readFileSync(path.join(root, "app/api/admin/import/legacy/route.ts"), "utf8");
  const applyIndex = route.indexOf("const step = await applyLegacyImportPlanStep");
  assert.ok(applyIndex > 0);
  const applySection = route.slice(0, applyIndex);
  assert.match(applySection, /legacyImportCpuBudgetErrors\(claimed\.plan\)/);
  assert.match(applySection, /requires_repreview: true/);
  assert.match(applySection, /await claimed\.release\(\)\.catch/);
  assert.ok(applySection.indexOf("legacyImportCpuBudgetErrors(claimed.plan)") < applyIndex);
});

test("legacy importは1 HTTPのplan・step・連続送信をhard capする", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const route = fs.readFileSync(path.join(root, "app/api/admin/import/legacy/route.ts"), "utf8");
  const client = fs.readFileSync(path.join(root, "src/components/admin/LegacyCanonicalImportClient.tsx"), "utf8");
  const previewStore = fs.readFileSync(path.join(root, "src/lib/import/legacy/previewStore.ts"), "utf8");
  const budget = fs.readFileSync(path.join(root, "src/lib/import/legacy/cpuBudget.ts"), "utf8");
  assert.match(route, /MAX_FILE_BYTES = 2 \* 1024 \* 1024/);
  assert.match(route, /MAX_TOTAL_BYTES = 4 \* 1024 \* 1024/);
  assert.match(route, /MAX_ROWS = MAX_LEGACY_IMPORT_SELECTED_ROWS/);
  assert.match(previewStore, /MAX_STORED_PLAN_BYTES = 512 \* 1024/);
  assert.match(previewStore, /PREVIEW_VERSION = 4 as const/);
  assert.match(budget, /MAX_LEGACY_IMPORT_STEP_BYTES = 128 \* 1024/);
  assert.ok(route.indexOf("storedPlanBytes > MAX_STORED_PLAN_BYTES") < route.indexOf("preflightLegacyImportPlan(db"));

  const submit = client.slice(client.indexOf("async function submit"), client.indexOf("const expiresLabel"));
  assert.match(client, /const submitInFlightRef = React\.useRef\(false\)/);
  assert.match(submit, /if \(!form \|\| pending \|\| submitInFlightRef\.current\) return/);
  assert.match(submit, /submitInFlightRef\.current = true/);
  assert.match(submit, /finally \{[\s\S]*submitInFlightRef\.current = false/);
  assert.match(submit, /const response = await fetch\("\/api\/admin\/import\/legacy"/);
  assert.doesNotMatch(submit, /Promise\.all|void fetch\(/);
  assert.match(submit, /await sleep\(applyStepPauseMs\(successStreak\)\)/);
});

test("legacy import中はYouTube APIを呼ばずpendingを後続cronへ渡す", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const importSources = [
    "app/api/admin/import/legacy/route.ts",
    "src/lib/import/legacy/normalize.ts",
    "src/lib/import/legacy/preflight.ts",
    "src/lib/import/legacy/apply.ts",
  ].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  const syncWorker = fs.readFileSync(path.join(root, "workers/youtube-sync/index.ts"), "utf8");
  assert.doesNotMatch(importSources, /\bfetch\s*\(/);
  assert.match(importSources, /'pending', NULL, \$\{now\}/);
  assert.match(syncWorker, /sync_status[\s\S]*pending/);
  assert.match(syncWorker, /fetchWithTimeout/);
});

test("previewErrorResponseはalready_claimedとbucket_unavailableをretryableにする", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const route = fs.readFileSync(path.join(root, "app/api/admin/import/legacy/route.ts"), "utf8");
  assert.match(route, /function previewErrorResponse/);
  assert.match(route, /CloudflareまたはR2が一時的に応答できませんでした/);
  assert.match(route, /\{ retryable, requires_repreview: !retryable \}/);
  assert.match(route, /cause\.code === "already_claimed" \? 423/);
  assert.match(route, /cause\.code === "bucket_unavailable" \? 503/);
  assert.match(route, /cause\.code === "claim_conflict"/);
  assert.match(route, /function isTransientApplyFailure/);
  assert.match(route, /isTransientDbError\(cause\)/);
  assert.match(route, /const requiresRepreview = !retryable/);
  assert.match(route, /retryable \? 503 : 409/);
  assert.match(route, /retryable,\s*requires_repreview: requiresRepreview/);
  assert.match(route, /kind: "committed_progress_pending"/);
  assert.match(route, /committed: true/);
  assert.match(route, /このステップは保存済み。進捗復旧中/);
  assert.match(route, /requires_repreview: false/);
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
