import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { parseLegacyImportText } from "./parse.ts";
import { normalizeLegacyFiles } from "./normalize.ts";

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

test("JSON/CSVを同じcanonical planへ変換する", () => {
  const files = [
    parseLegacyImportText("events.json", eventJson),
    parseLegacyImportText("videos.csv", videoCsv),
  ];
  const plan = normalizeLegacyFiles(files, {
    eventVisibility: "public",
    videoVisibility: "private",
    now: 1_700_000_000,
  });
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

test("旧DB列をcanonical planへ残さない", () => {
  const plan = normalizeLegacyFiles([parseLegacyImportText("videos.csv", videoCsv)], {
    eventVisibility: "public",
    videoVisibility: "public",
  });
  const serialized = JSON.stringify(plan);
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
