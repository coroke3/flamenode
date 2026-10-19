import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_VIDEO_STATUSES,
  MANAGE_VIDEO_STATUSES,
  mergeVideoRebuildEventIds,
  monotonicVideoUpdatedAt,
  planVideoVisibilityFence,
  validateAdminVideoStatusInput,
  validateManageVideoStatusInput,
  validateVideoPublicEligibility,
} from "@flamenode/domain/video";

const STATUSES = ["pending", "public", "private", "voided"];

test("fence: only crossing the public boundary needs a fence", () => {
  for (const prev of STATUSES) {
    for (const next of STATUSES) {
      const fence = planVideoVisibilityFence(prev, next);
      if (prev === "public" && next !== "public") {
        assert.deepEqual(fence, { state: "blocked", depublicizedFromPublic: true });
      } else if (prev !== "public" && next === "public") {
        assert.deepEqual(fence, { state: "release_pending", depublicizedFromPublic: false });
      } else {
        assert.equal(fence, null, `${prev} -> ${next}`);
      }
    }
  }
});

test("admin status input: same checks and messages as SA-001..003", () => {
  assert.deepEqual([...ADMIN_VIDEO_STATUSES], STATUSES);
  assert.deepEqual(validateAdminVideoStatusInput({ videoId: "", status: "public", reason: "" }), { ok: false, message: "video_idが不正です。" });
  assert.deepEqual(validateAdminVideoStatusInput({ videoId: "v".repeat(129), status: "public", reason: "" }), { ok: false, message: "video_idが不正です。" });
  assert.deepEqual(validateAdminVideoStatusInput({ videoId: "v", status: "x", reason: "" }), { ok: false, message: "不正なステータスです。" });
  assert.deepEqual(validateAdminVideoStatusInput({ videoId: "v", status: "voided", reason: "" }), { ok: false, message: "voidedへの変更には理由が必要です。" });
  assert.deepEqual(validateAdminVideoStatusInput({ videoId: "v".repeat(128), status: "voided", reason: "r" }), { ok: true });
});

test("manage status input: event staff can never set voided (SA-040..042)", () => {
  assert.deepEqual([...MANAGE_VIDEO_STATUSES], ["pending", "public", "private"]);
  assert.deepEqual(validateManageVideoStatusInput({ eventId: "", videoId: "v", status: "public" }), { ok: false, message: "event_id と video_id が必要です。" });
  assert.deepEqual(validateManageVideoStatusInput({ eventId: "e", videoId: "", status: "public" }), { ok: false, message: "event_id と video_id が必要です。" });
  assert.deepEqual(validateManageVideoStatusInput({ eventId: "e", videoId: "v", status: "voided" }), { ok: false, message: "このステータスへは変更できません。" });
  assert.deepEqual(validateManageVideoStatusInput({ eventId: "e", videoId: "v", status: "private" }), { ok: true });
});

test("status helpers keep CURRENT semantics", () => {
  assert.equal(monotonicVideoUpdatedAt(100, 50), 101);
  assert.equal(monotonicVideoUpdatedAt(100, 500), 500);
  assert.deepEqual(mergeVideoRebuildEventIds(null, ["a", "a", "b"]), ["a", "b"]);
  assert.deepEqual(validateVideoPublicEligibility({ source_type: "youtube", youtube_video_id: null }, "public"), { ok: true });
});
