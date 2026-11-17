import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveAdminVideoMemberSaveEffects,
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

test("SA-085 U03s: derived metadata/no-op flags match CURRENT for the same member plan", () => {
  const common = {
    previousCollaborationType: "individual",
    members: [],
    isCollab: false,
    isPublicVideo: true,
    creatorXUserId: "owner",
  };
  const noOp = deriveAdminVideoMemberSaveEffects({
    ...common, membersPlan: { statements: [], audits: [] },
  });
  assert.deepEqual(noOp, {
    nextCollaborationType: "individual",
    videoPublicContentChanged: false,
    membersPlanChanged: false,
    affectedCreatorIds: new Set(),
  });
  const metadataOnly = deriveAdminVideoMemberSaveEffects({
    ...common, isCollab: true, membersPlan: { statements: [], audits: [] },
  });
  assert.equal(metadataOnly.nextCollaborationType, "collab");
  assert.equal(metadataOnly.videoPublicContentChanged, true);
  assert.equal(metadataOnly.membersPlanChanged, false);
  const chapterOnly = deriveAdminVideoMemberSaveEffects({
    ...common,
    membersPlan: { statements: [{}], audits: [{ table_name: "video_chapters_member_set" }] },
  });
  assert.equal(chapterOnly.videoPublicContentChanged, true);
  assert.equal(chapterOnly.membersPlanChanged, true);
  assert.deepEqual([...chapterOnly.affectedCreatorIds], [], "chapter-only must not rebuild member profiles");
});

test("SA-085 U03s: public member-set delta targets only removed/added X users", () => {
  const membersPlan = {
    statements: [{}],
    audits: [{
      table_name: "video_members_set",
      before: { id: "video-1", rows: [
        snapshotRow("m1", "Alice"),
        snapshotRow("m2", "Bob"),
      ] },
    }],
  };
  const common = {
    membersPlan, previousCollaborationType: "collab",
    members: [{ x_user_id: "@ALICE" }, { x_user_id: "carol" }],
    isCollab: true, creatorXUserId: "owner",
  };
  const publicEffect = deriveAdminVideoMemberSaveEffects({ ...common, isPublicVideo: true });
  assert.equal(publicEffect.nextCollaborationType, "collab");
  assert.equal(publicEffect.videoPublicContentChanged, true);
  assert.equal(publicEffect.membersPlanChanged, true);
  assert.deepEqual([...publicEffect.affectedCreatorIds], ["bob", "carol"]);
  const privateEffect = deriveAdminVideoMemberSaveEffects({ ...common, isPublicVideo: false });
  assert.deepEqual([...privateEffect.affectedCreatorIds], [], "private video cannot fan out public user pages");
});
