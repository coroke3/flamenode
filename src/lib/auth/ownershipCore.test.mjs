/**
 * ownershipCore.ts の単体テスト。
 *
 * ownership.ts は `import "server-only"` を含むため直接 import できないが、
 * ownershipCore.ts は純粋関数のみを export しているためテスト可能。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_PERMISSION_ALIASES,
  shouldWarnManageActiveXMismatch,
  resolveVideoOwnershipSync,
  adminPolicyAllows,
  creatorOwnerCanManagePermissions,
  ownerPolicyAllows,
  decideCanEditVideoFromAccessContext,
} from "./ownershipCore.ts";
import { ALL_PERMISSION_KEYS } from "./permissions/keys.ts";
import { GENERAL_EDITABLE_FIELD_KEYS } from "../video/generalEditPermissionsCore.ts";

const SECTION_KEYS = Object.keys(VIDEO_PERMISSION_ALIASES);
const ALL_FIELDS = new Set(GENERAL_EDITABLE_FIELD_KEYS);
const creator = resolveVideoOwnershipSync({
  approvedXUserIds: ["x1"],
  creatorXUserId: "x1",
  hasCollaboratorEdit: false,
});
const collaborator = resolveVideoOwnershipSync({
  approvedXUserIds: ["x2"],
  creatorXUserId: "x1",
  hasCollaboratorEdit: true,
});
const stranger = resolveVideoOwnershipSync({
  approvedXUserIds: ["x2"],
  creatorXUserId: "x1",
  hasCollaboratorEdit: false,
});

/** 作品のイベント event-1 で staffKeys を持つ利用者の request-local context。 */
function decide(privilegeMode, requiredKey, {
  userRole = "user",
  ownership = stranger,
  fields = new Set(),
  staffKeys = [],
} = {}) {
  return decideCanEditVideoFromAccessContext({
    context: {
      userId: "user-1",
      videoId: "video-1",
      approvedXUserIds: ["x2"],
      ownership,
      currentEventIds: ["event-1"],
      ownerEditableFields: fields,
      eventPermissionKeysByEvent: staffKeys.length > 0
        ? new Map([["event-1", new Set(staffKeys)]])
        : new Map(),
    },
    userRole,
    requiredKey,
    privilegeMode,
  });
}

// --- shouldWarnManageActiveXMismatch ---

test("shouldWarnManageActiveXMismatch: activeX が null なら false", () => {
  assert.equal(shouldWarnManageActiveXMismatch(null, ["x1"]), false);
});

test("shouldWarnManageActiveXMismatch: activeX が undefined なら false", () => {
  assert.equal(shouldWarnManageActiveXMismatch(undefined, ["x1"]), false);
});

test("shouldWarnManageActiveXMismatch: activeX が空文字なら false", () => {
  assert.equal(shouldWarnManageActiveXMismatch("", ["x1"]), false);
});

test("shouldWarnManageActiveXMismatch: staffXIds が空配列なら false", () => {
  assert.equal(shouldWarnManageActiveXMismatch("x1", []), false);
});

test("shouldWarnManageActiveXMismatch: activeX が staff に含まれるなら false", () => {
  assert.equal(shouldWarnManageActiveXMismatch("x1", ["x1", "x2"]), false);
});

test("shouldWarnManageActiveXMismatch: activeX が staff に含まれないなら true", () => {
  assert.equal(shouldWarnManageActiveXMismatch("x3", ["x1", "x2"]), true);
});

test("shouldWarnManageActiveXMismatch: activeX が空白を含む場合は trim して判定", () => {
  assert.equal(shouldWarnManageActiveXMismatch(" x1 ", ["x1"]), false);
  assert.equal(shouldWarnManageActiveXMismatch(" x3 ", ["x1", "x2"]), true);
});

// --- VIDEO_PERMISSION_ALIASES の一貫性 ---

test("VIDEO_PERMISSION_ALIASES: 全 VideoEditSectionKey がキーとして存在", () => {
  const expectedKeys = [
    "video.basics", "video.identity", "video.descriptions", "video.credits",
    "video.members", "video.member_chapters", "video.youtube_id",
    "video.primary_event", "video.status", "video.chapter_admin",
    "videos.title", "videos.music_credit", "videos.members",
    "videos.review_data", "videos.youtube_id", "videos.primary_event",
  ];
  for (const k of expectedKeys) {
    assert.ok(k in VIDEO_PERMISSION_ALIASES, `Missing alias for "${k}"`);
  }
});

test("VIDEO_PERMISSION_ALIASES: 各エントリは自身を含む", () => {
  for (const [key, aliases] of Object.entries(VIDEO_PERMISSION_ALIASES)) {
    assert.ok(
      aliases.includes(key),
      `Alias for "${key}" does not include itself`,
    );
  }
});

test("VIDEO_PERMISSION_ALIASES: video.youtube_id ↔ videos.youtube_id 双方向", () => {
  assert.ok(VIDEO_PERMISSION_ALIASES["video.youtube_id"].includes("videos.youtube_id"));
  assert.ok(VIDEO_PERMISSION_ALIASES["videos.youtube_id"].includes("video.youtube_id"));
});

test("VIDEO_PERMISSION_ALIASES: video.primary_event ↔ videos.primary_event 双方向", () => {
  assert.ok(VIDEO_PERMISSION_ALIASES["video.primary_event"].includes("videos.primary_event"));
  assert.ok(VIDEO_PERMISSION_ALIASES["videos.primary_event"].includes("video.primary_event"));
});

test("VIDEO_PERMISSION_ALIASES: video.status は自分自身のみ", () => {
  assert.deepEqual(VIDEO_PERMISSION_ALIASES["video.status"], ["video.status"]);
});

test("VIDEO_PERMISSION_ALIASES: video.chapter_admin は member_chapters へ互換変換される", () => {
  assert.deepEqual(VIDEO_PERMISSION_ALIASES["video.chapter_admin"], [
    "video.chapter_admin",
    "video.member_chapters",
  ]);
});

// --- resolveVideoOwnershipSync (所有者判定 1-6) ---

test("resolveVideoOwnershipSync: 作者 X が承認済みなら isCreatorOwner / isOwner", () => {
  const o = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(o.isCreatorOwner, true);
  assert.equal(o.isCollaboratorOwner, false);
  assert.equal(o.isOwner, true);
});

test("resolveVideoOwnershipSync: 作者 X が未承認なら isCreatorOwner false", () => {
  const o = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(o.isCreatorOwner, false);
  assert.equal(o.isOwner, false);
});

test("resolveVideoOwnershipSync: can_edit 合作のみなら isCollaboratorOwner / isOwner", () => {
  const o = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: true,
  });
  assert.equal(o.isCreatorOwner, false);
  assert.equal(o.isCollaboratorOwner, true);
  assert.equal(o.isOwner, true);
});

test("resolveVideoOwnershipSync: 作者と合作の両方なら両方 true", () => {
  const o = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: true,
  });
  assert.equal(o.isCreatorOwner, true);
  assert.equal(o.isCollaboratorOwner, true);
  assert.equal(o.isOwner, true);
});

test("resolveVideoOwnershipSync: 作者未承認かつ合作なしなら isOwner false", () => {
  const o = resolveVideoOwnershipSync({
    approvedXUserIds: ["x3"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(o.isOwner, false);
});

test("resolveVideoOwnershipSync: creatorXUserId の前後空白は trim して判定", () => {
  const o = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: " x1 ",
    hasCollaboratorEdit: false,
  });
  assert.equal(o.isCreatorOwner, true);
  assert.equal(o.isOwner, true);
});


// --- 通常モード (所有者 + 一般作品権限) ---

test("通常モード: 所有者は一般作品権限の field に対応する section だけ編集できる", () => {
  const fields = new Set(["title"]);
  assert.equal(decide("normal", "video.basics", { ownership: creator, fields }), true);
  assert.equal(decide("normal", "videos.title", { ownership: collaborator, fields }), true);
  assert.equal(decide("normal", "video.descriptions", { ownership: creator, fields }), false);
});

test("通常モード: 所有者でも status と chapter_admin は全 field でも許可しない", () => {
  for (const ownership of [creator, collaborator]) {
    for (const requiredKey of ["video.status", "video.chapter_admin"]) {
      assert.equal(decide("normal", requiredKey, { ownership, fields: ALL_FIELDS }), false, requiredKey);
    }
  }
});

test("通常モード: 非所有者は全 field と全 event_staff 権限があっても拒否する", () => {
  for (const requiredKey of SECTION_KEYS) {
    assert.equal(
      decide("normal", requiredKey, { fields: ALL_FIELDS, staffKeys: ALL_PERMISSION_KEYS }),
      false,
      requiredKey,
    );
  }
});

test("通常モード: video.permissions は作者所有者だけに許可する", () => {
  assert.equal(creatorOwnerCanManagePermissions(creator, "video.permissions"), true);
  assert.equal(creatorOwnerCanManagePermissions(collaborator, "video.permissions"), false);
  // 作者は一般作品権限が空でも管理でき、合作所有者は全 field でも管理できない。
  assert.equal(decide("normal", "video.permissions", { ownership: creator }), true);
  assert.equal(
    decide("normal", "video.permissions", { ownership: collaborator, fields: ALL_FIELDS }),
    false,
  );
});

// --- イベント運営モード ---

test("event モード: 対象イベントの event_staff 権限があれば非所有者も許可する", () => {
  assert.equal(decide("event", "video.basics", { staffKeys: ["video.basics"] }), true);
  // 危険 section も event_staff 権限で許可する。
  assert.equal(decide("event", "video.identity", { staffKeys: ALL_PERMISSION_KEYS }), true);
  assert.equal(decide("event", "video.status", { staffKeys: ALL_PERMISSION_KEYS }), true);
});

test("event モード: event_staff 権限が無ければ所有者・site admin でも拒否する", () => {
  for (const requiredKey of SECTION_KEYS) {
    assert.equal(
      decide("event", requiredKey, { userRole: "admin", ownership: creator, fields: ALL_FIELDS }),
      false,
      requiredKey,
    );
  }
});

// --- 管理者モード ---

test("admin モード: site admin だけが既知 section を編集できる", () => {
  for (const requiredKey of SECTION_KEYS) {
    assert.equal(decide("admin", requiredKey, { userRole: "admin" }), true, requiredKey);
    assert.equal(
      decide("admin", requiredKey, {
        ownership: creator,
        fields: ALL_FIELDS,
        staffKeys: ALL_PERMISSION_KEYS,
      }),
      false,
      requiredKey,
    );
  }
});

// --- 権限源を混ぜない ---

test("各モードは自分の権限源だけで決まり、未知のモードは拒否する", () => {
  for (const requiredKey of SECTION_KEYS) {
    for (const userRole of ["admin", "user", null]) {
      for (const ownership of [creator, collaborator, stranger]) {
        for (const fields of [new Set(), ALL_FIELDS]) {
          for (const staffKeys of [[], ALL_PERMISSION_KEYS]) {
            const input = { userRole, ownership, fields, staffKeys };
            const label = `${requiredKey} role=${userRole} owner=${JSON.stringify(ownership)} fields=${fields.size} staff=${staffKeys.length}`;
            assert.equal(decide("admin", requiredKey, input), adminPolicyAllows(userRole, requiredKey), label);
            assert.equal(decide("event", requiredKey, input), decide("event", requiredKey, { staffKeys }), label);
            assert.equal(decide("normal", requiredKey, input), ownerPolicyAllows(ownership, requiredKey, fields), label);
            assert.equal(decide("any", requiredKey, input), false, label);
          }
        }
      }
    }
  }
});

test("adminPolicyAllows: admin 以外は拒否", () => {
  assert.equal(adminPolicyAllows("user", "video.basics"), false);
  assert.equal(adminPolicyAllows(null, "video.basics"), false);
});

test("adminPolicyAllows: admin は既知キーを許可", () => {
  assert.equal(adminPolicyAllows("admin", "video.basics"), true);
  assert.equal(adminPolicyAllows("admin", "video.identity"), true);
});
