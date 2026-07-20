import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { parseLegacyImportText } from "./parse.ts";
import { normalizeLegacyFiles } from "./normalize.ts";
import {
  createLegacyImportPreviewToken,
  fingerprintLegacyImport,
  verifyLegacyImportPreviewToken,
} from "./previewToken.ts";

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

test("TSVと引用符付きCSVを解析できる", () => {
  const tsv = "eventid\teventname\tmember\tmemberid\nfoo\tFoo Event\tMochi\tmochi\n";
  const parsedTsv = parseLegacyImportText("events.tsv", tsv);
  assert.equal(parsedTsv.rows[0].eventname, "Foo Event");

  const quoted = 'title,creator,tlink,credit\n"作品, A",Creator,creator_x,"line1\nline2"\n';
  const parsedCsv = parseLegacyImportText("videos.csv", quoted);
  assert.equal(parsedCsv.rows[0].title, "作品, A");
  assert.equal(parsedCsv.rows[0].credit, "line1\nline2");
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

test("preview tokenは利用者・内容・期限に束縛される", async () => {
  const plan = fixturePlan();
  const args = {
    plan,
    eventVisibility: "public",
    videoVisibility: "private",
    strategy: "create_only",
  };
  const fingerprint = await fingerprintLegacyImport(args);
  const token = await createLegacyImportPreviewToken({
    secret: "test-secret",
    actorAuthUserId: "auth-user-1",
    fingerprint,
    now: 1000,
  });
  assert.equal(
    await verifyLegacyImportPreviewToken({
      token,
      secret: "test-secret",
      actorAuthUserId: "auth-user-1",
      fingerprint,
      now: 1001,
    }),
    true,
  );
  assert.equal(
    await verifyLegacyImportPreviewToken({
      token,
      secret: "test-secret",
      actorAuthUserId: "auth-user-2",
      fingerprint,
      now: 1001,
    }),
    false,
  );
  const changedFingerprint = await fingerprintLegacyImport({ ...args, strategy: "skip_existing" });
  assert.equal(
    await verifyLegacyImportPreviewToken({
      token,
      secret: "test-secret",
      actorAuthUserId: "auth-user-1",
      fingerprint: changedFingerprint,
      now: 1001,
    }),
    false,
  );
  assert.equal(
    await verifyLegacyImportPreviewToken({
      token,
      secret: "test-secret",
      actorAuthUserId: "auth-user-1",
      fingerprint,
      now: 2000,
    }),
    false,
  );
});

test("ランタイム側に旧テーブル・dual-writeを導入しない", () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const files = [
    "src/lib/import/legacy/apply.ts",
    "app/api/admin/import/legacy/route.ts",
  ];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  for (const forbidden of [
    "x_account_link_requests",
    "x_id_merge_requests",
    "x_id_merge_reverts",
    "x_users.linked_user_id",
    "video_members.chapters_json",
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
