import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectMemberAggregationAffectedXUserIds,
  extractPreviousPublicMemberXUserIdsFromMembersPlan,
} from "../src/video/memberAggregationFanOut.ts";

const snapshotRow = (id, xid, extra = {}) => ({
  id, video_id: "video-1", x_user_id: xid, name: id,
  order_index: 0, can_edit: 1, is_public_member: 1, ...extra,
});
const plan = (rows) => ({
  audits: [{
    table_name: "video_members_set",
    before: { id: "video-1", rows },
  }],
});

test("SA-085: prior public X IDs are normalized and deduplicated from the audit snapshot", () => {
  const input = plan([
    snapshotRow("m1", " @ALICE "),
    snapshotRow("m2", "alice"),
    snapshotRow("m3", "Bob"),
    snapshotRow("m4", null),
  ]);
  assert.deepEqual(extractPreviousPublicMemberXUserIdsFromMembersPlan(input), ["alice", "bob"]);
});

test("SA-085: missing or invalid member snapshot fails closed to an empty set", () => {
  assert.deepEqual(extractPreviousPublicMemberXUserIdsFromMembersPlan({ audits: [] }), []);
  assert.deepEqual(extractPreviousPublicMemberXUserIdsFromMembersPlan({
    audits: [{ table_name: "video_members_set", before: { id: "video-1", rows: [{ id: 3 }] } }],
  }), []);
});

test("SA-085: changed members return old/new symmetric difference only", () => {
  const affected = collectMemberAggregationAffectedXUserIds({
    previousCreatorXUserId: "Owner",
    nextCreatorXUserId: "@OWNER",
    previousMemberXUserIds: ["@ALICE", "bob"],
    nextMembers: [{ x_user_id: "alice" }, { x_user_id: "CAROL" }],
  });
  assert.deepEqual([...affected], ["bob", "carol"]);
});

test("SA-085: creator transfer enqueues both old and new creator pages", () => {
  const affected = collectMemberAggregationAffectedXUserIds({
    previousCreatorXUserId: "@OLD",
    nextCreatorXUserId: "New",
    previousMemberXUserIds: [],
    nextMembers: [],
  });
  assert.deepEqual([...affected], ["old", "new"]);
});

test("SA-085: no member/creator change returns no rebuild targets", () => {
  const affected = collectMemberAggregationAffectedXUserIds({
    previousCreatorXUserId: "owner",
    nextCreatorXUserId: "OWNER",
    previousMemberXUserIds: ["A", "B"],
    nextMembers: [{ x_user_id: "@a" }, { x_user_id: "b" }],
  });
  assert.deepEqual([...affected], []);
});
