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

test("MIG-0650 U03cj: public user fanout uses canonical persisted after-snapshot, not submitted aliases", () => {
  const common = {
    membersPlan: {
      statements: [{}],
      audits: [{
        table_name: "video_members_set",
        before: { id: "video-1", rows: [snapshotRow("prior", "bob")] },
        after: { id: "video-1", rows: [snapshotRow("after", "alice")] },
      }],
    },
    previousCollaborationType: "collab",
    members: [{ x_user_id: "alias_alice" }],
    isCollab: true,
    isPublicVideo: true,
    creatorXUserId: "owner",
  };
  const result = deriveAdminVideoMemberSaveEffects(common);
  assert.deepEqual([...result.affectedCreatorIds], ["bob", "alice"],
    "removed user and persisted canonical new user must be invalidated");
  assert.equal(result.affectedCreatorIds.has("alias_alice"), false,
    "input alias is not a public aggregate key");
  assert.equal(result.videoPublicContentChanged, true);
  assert.equal(result.nextCollaborationType, "collab");

  const noIdentityChange = deriveAdminVideoMemberSaveEffects({
    ...common,
    membersPlan: {
      statements: [{}],
      audits: [{
        table_name: "video_members_set",
        before: { id: "video-1", rows: [snapshotRow("before", "alice")] },
        after: { id: "video-1", rows: [snapshotRow("after", "alice")] },
      }],
    },
  });
  assert.deepEqual([...noIdentityChange.affectedCreatorIds], [],
    "an alias-only form edit does not invalidate an unchanged canonical user");
});

test("MIG-0650 U03cl: malformed explicit public X-audit snapshots cannot fall back to alias inputs", () => {
  const base = {
    membersPlan: {
      statements: [{}],
      audits: [{
        table_name: "video_members_set",
        before: { id: "video-1", rows: [snapshotRow("old", "bob")] },
        after: { id: "video-1", rows: [snapshotRow("new", "alice")] },
      }],
    },
    previousCollaborationType: "collab",
    members: [{ x_user_id: "alias_alice" }],
    isCollab: true, isPublicVideo: true, creatorXUserId: "owner",
  };
  const afterBad = [
    null,
    { id: "video-1", rows: [{ ...snapshotRow("new", "alice"), x_user_id: 42 }] },
    { id: "video-1", rows: [{ ...snapshotRow("new", "alice"), video_id: "foreign-video" }] },
    { id: "video-1", rows: new Array(1) },
  ];
  for (const after of afterBad) {
    assert.throws(() => deriveAdminVideoMemberSaveEffects({
      ...base,
      membersPlan: {
        ...base.membersPlan,
        audits: [{ ...base.membersPlan.audits[0], after }],
      },
    }), {
      name: "RangeError", message: "video_member_fanout_invalid_audit_snapshot",
    }, "a malformed explicit after-snapshot must not enqueue an uncanonical alias");
  }
  const malformedBefore = {
    id: "video-1", rows: [{ ...snapshotRow("old", "bob"), x_user_id: 42 }],
  };
  assert.throws(() => deriveAdminVideoMemberSaveEffects({
    ...base,
    membersPlan: {
      ...base.membersPlan,
      audits: [{ ...base.membersPlan.audits[0], before: malformedBefore }],
    },
  }), { name: "RangeError", message: "video_member_fanout_invalid_audit_snapshot" },
  "an invalid previous X ID must not suppress removal invalidation");
  // Two individually valid audits must still describe the SAME video.
  // Otherwise old-profile invalidation can be misdirected to another video.
  const crossVideo = {
    id: "video-2",
    rows: [{ ...snapshotRow("new", "alice"), video_id: "video-2" }],
  };
  assert.throws(() => deriveAdminVideoMemberSaveEffects({
    ...base,
    membersPlan: {
      ...base.membersPlan,
      audits: [{ ...base.membersPlan.audits[0], after: crossVideo }],
    },
  }), { name: "RangeError", message: "video_member_fanout_invalid_audit_snapshot" },
  "well-formed but cross-video before/after snapshots must not be mixed");

  assert.throws(() => deriveAdminVideoMemberSaveEffects({
    ...base,
    membersPlan: {
      ...base.membersPlan,
      audits: [base.membersPlan.audits[0], {
        ...base.membersPlan.audits[0],
        after: { id: "video-1", rows: [snapshotRow("other", "carol")] },
      }],
    },
  }), { name: "RangeError", message: "video_member_fanout_invalid_audit_snapshot" },
  "duplicate member audits must not silently select an arbitrary first delta");

  const valid = deriveAdminVideoMemberSaveEffects(base);
  assert.deepEqual([...valid.affectedCreatorIds], ["bob", "alice"]);
  const legacyMissingAfter = deriveAdminVideoMemberSaveEffects({
    ...base,
    membersPlan: {
      ...base.membersPlan,
      audits: [{ table_name: "video_members_set", before: base.membersPlan.audits[0].before }],
    },
  });
  assert.deepEqual([...legacyMissingAfter.affectedCreatorIds], ["bob", "alias_alice"],
    "legacy pure caller with absent (not malformed) after still has its existing fallback");
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
