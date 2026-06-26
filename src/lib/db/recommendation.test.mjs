import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampRelatedLimit,
  enforceDiversity,
  interleaveBuckets,
  perMemberLimit,
  uniqueByVideoId,
} from "./recommendation.ts";

function row(id, creator_x_user_id = null, primary_event_id = null) {
  return { id, creator_x_user_id, primary_event_id };
}

test("clampRelatedLimit clamps to 15-30 with default 18", () => {
  assert.equal(clampRelatedLimit(), 18);
  assert.equal(clampRelatedLimit(10), 15);
  assert.equal(clampRelatedLimit(18), 18);
  assert.equal(clampRelatedLimit(30), 30);
  assert.equal(clampRelatedLimit(100), 30);
});

test("perMemberLimit follows member count buckets", () => {
  assert.equal(perMemberLimit(1), 3);
  assert.equal(perMemberLimit(2), 3);
  assert.equal(perMemberLimit(3), 2);
  assert.equal(perMemberLimit(5), 2);
  assert.equal(perMemberLimit(6), 1);
});

test("uniqueByVideoId removes duplicate videos", () => {
  assert.deepEqual(
    uniqueByVideoId([row("a"), row("b"), row("a")]).map((r) => r.id),
    ["a", "b"],
  );
});

test("interleaveBuckets mixes buckets in priority order", () => {
  const mixed = interleaveBuckets([
    { reason: "previous_date", rows: [row("p1"), row("p2")] },
    { reason: "shared_member", rows: [row("m1")] },
    { reason: "same_event", rows: [row("e1"), row("e2")] },
  ]);
  assert.deepEqual(
    mixed.map((item) => `${item.reason}:${item.row.id}`),
    [
      "previous_date:p1",
      "shared_member:m1",
      "same_event:e1",
      "previous_date:p2",
      "same_event:e2",
    ],
  );
});

test("enforceDiversity avoids consecutive same creator when possible", () => {
  const candidates = [
    { reason: "same_creator", row: row("a1", "a") },
    { reason: "same_creator", row: row("a2", "a") },
    { reason: "same_event", row: row("b1", "b") },
    { reason: "same_event", row: row("c1", "c") },
  ];
  const selected = enforceDiversity(candidates, { limit: 15, minTarget: 3 });
  assert.deepEqual(
    selected.slice(0, 3).map((item) => item.row.id),
    ["a1", "b1", "c1"],
  );
});
