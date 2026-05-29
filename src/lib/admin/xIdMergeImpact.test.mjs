import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeMergeImpact, totalMergeImpact } from "./xIdMergeImpactCore.ts";

test("totalMergeImpact: sums positive counts", () => {
  assert.equal(
    totalMergeImpact([
      { key: "a", label: "A", count: 2 },
      { key: "b", label: "B", count: 0 },
      { key: "c", label: "C", count: 3 },
    ]),
    5,
  );
});

test("summarizeMergeImpact: reports no impact", () => {
  assert.equal(
    summarizeMergeImpact([{ key: "a", label: "A", count: 0 }]),
    "影響行はありません。",
  );
});

test("summarizeMergeImpact: includes changed labels", () => {
  assert.equal(
    summarizeMergeImpact([
      { key: "videos.creator_x_user_id", label: "作品投稿者", count: 2 },
      { key: "video_members.x_user_id", label: "合作メンバー", count: 1 },
    ]),
    "作品投稿者: 2 / 合作メンバー: 1",
  );
});
