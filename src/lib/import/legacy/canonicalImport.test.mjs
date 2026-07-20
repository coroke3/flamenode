import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { parseLegacyImportText } from "./parse.ts";
import { normalizeLegacyFiles } from "./normalize.ts";
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
  const second = await claimLegacyImportPreview(
    bucket,
    {
      authUserId: "auth-user-1",
      previewToken,
      planHash: credential.planHash,
    },
    { now: 1_004, claimId: "c".repeat(32) },
  );
  assert.equal(second.attempt, 2);
  await second.complete();

  await assert.rejects(
    claimLegacyImportPreview(
      bucket,
      {
        authUserId: "auth-user-1",
        previewToken,
        planHash: credential.planHash,
      },
      { now: 1_005 },
    ),
    (error) => error instanceof LegacyImportPreviewError && error.code === "not_found",
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
  assert.match(client, /new FormData\(\)/);
  assert.match(client, /plan_hash/);
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
