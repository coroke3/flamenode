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
  NORMAL_SAFE_VIDEO_EDIT_KEYS,
  DANGEROUS_ADMIN_VIDEO_EDIT_KEYS,
  COLLABORATOR_VIDEO_EDIT_KEYS,
  USER_DELEGATABLE_KEYS,
  DEFAULT_OWNER_GENERAL_POLICY_KEYS,
  OWNER_GENERAL_POLICY_WHITELIST,
  isSafeNormalVideoEditKey,
  isDangerousAdminVideoEditKey,
  isUserDelegatableKey,
  shouldWarnManageActiveXMismatch,
  parseDelegatablePermissionKeys,
  resolveVideoOwnershipSync,
  adminPolicyAllows,
  ownerGeneralPolicyAllows,
  creatorOwnerCanManagePermissions,
  decideCanEditVideo,
  resolveOwnerGeneralPolicyKeys,
} from "./ownershipCore.ts";

/** decideCanEditVideo の normal モード呼び出し短縮 */
function decideNormal(args) {
  return decideCanEditVideo({
    privilegeMode: "normal",
    userRole: args.userRole ?? "user",
    ownership: args.ownership,
    requiredKey: args.requiredKey,
    ownerPolicyKeys:
      args.ownerPolicyKeys ?? DEFAULT_OWNER_GENERAL_POLICY_KEYS,
    eventStaffAllows: args.eventStaffAllows ?? false,
  });
}

/** decideCanEditVideo の event モード呼び出し短縮 */
function decideEvent(args) {
  return decideCanEditVideo({
    privilegeMode: "event",
    userRole: args.userRole ?? "user",
    ownership: args.ownership,
    requiredKey: args.requiredKey,
    ownerPolicyKeys: args.ownerPolicyKeys ?? new Set(),
    eventStaffAllows: args.eventStaffAllows ?? false,
  });
}

/** decideCanEditVideo の admin モード呼び出し短縮 */
function decideAdmin(args) {
  return decideCanEditVideo({
    privilegeMode: "admin",
    userRole: args.userRole ?? "admin",
    ownership: args.ownership,
    requiredKey: args.requiredKey,
    ownerPolicyKeys: args.ownerPolicyKeys ?? new Set(),
    eventStaffAllows: false,
  });
}

// --- isSafeNormalVideoEditKey ---

test("isSafeNormalVideoEditKey: safe キーは true", () => {
  for (const k of NORMAL_SAFE_VIDEO_EDIT_KEYS) {
    assert.equal(isSafeNormalVideoEditKey(k), true, `${k} should be safe`);
  }
});

test("isSafeNormalVideoEditKey: dangerous キーは false", () => {
  for (const k of DANGEROUS_ADMIN_VIDEO_EDIT_KEYS) {
    assert.equal(isSafeNormalVideoEditKey(k), false, `${k} should NOT be safe`);
  }
});

// --- isDangerousAdminVideoEditKey ---

test("isDangerousAdminVideoEditKey: dangerous キーは true", () => {
  for (const k of DANGEROUS_ADMIN_VIDEO_EDIT_KEYS) {
    assert.equal(isDangerousAdminVideoEditKey(k), true, `${k} should be dangerous`);
  }
});

test("isDangerousAdminVideoEditKey: safe キーは false", () => {
  for (const k of NORMAL_SAFE_VIDEO_EDIT_KEYS) {
    assert.equal(isDangerousAdminVideoEditKey(k), false, `${k} should NOT be dangerous`);
  }
});

// --- セキュリティ: safe と dangerous が重複しない ---

test("NORMAL_SAFE と DANGEROUS_ADMIN は重複しない", () => {
  for (const k of NORMAL_SAFE_VIDEO_EDIT_KEYS) {
    assert.equal(
      DANGEROUS_ADMIN_VIDEO_EDIT_KEYS.has(k),
      false,
      `"${k}" is in both safe and dangerous sets`,
    );
  }
});

// --- isUserDelegatableKey ---

test("isUserDelegatableKey: delegatable キーは true", () => {
  for (const k of USER_DELEGATABLE_KEYS) {
    assert.equal(isUserDelegatableKey(k), true, `${k} should be delegatable`);
  }
});

test("isUserDelegatableKey: 危険キーは delegatable でない", () => {
  for (const k of DANGEROUS_ADMIN_VIDEO_EDIT_KEYS) {
    assert.equal(isUserDelegatableKey(k), false, `${k} should NOT be delegatable`);
  }
});

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

// --- parseDelegatablePermissionKeys ---

test("parseDelegatablePermissionKeys: null なら空 Set", () => {
  const result = parseDelegatablePermissionKeys(null);
  assert.equal(result.size, 0);
});

test("parseDelegatablePermissionKeys: undefined なら空 Set", () => {
  const result = parseDelegatablePermissionKeys(undefined);
  assert.equal(result.size, 0);
});

test("parseDelegatablePermissionKeys: 空文字列なら空 Set", () => {
  const result = parseDelegatablePermissionKeys("");
  assert.equal(result.size, 0);
});

test("parseDelegatablePermissionKeys: 不正 JSON なら空 Set (fail-closed)", () => {
  const result = parseDelegatablePermissionKeys("not json");
  assert.equal(result.size, 0);
});

test("parseDelegatablePermissionKeys: 配列でない JSON なら空 Set", () => {
  const result = parseDelegatablePermissionKeys('{"key": "value"}');
  assert.equal(result.size, 0);
});

test("parseDelegatablePermissionKeys: delegatable キーのみ抽出", () => {
  const result = parseDelegatablePermissionKeys(
    JSON.stringify(["videos.title", "video.descriptions", "video.identity"]),
  );
  assert.equal(result.size, 2);
  assert.ok(result.has("videos.title"));
  assert.ok(result.has("video.descriptions"));
  assert.ok(!result.has("video.identity")); // 危険キーは除外
});

test("parseDelegatablePermissionKeys: 非文字列要素は無視", () => {
  const result = parseDelegatablePermissionKeys(
    JSON.stringify([123, null, "videos.title"]),
  );
  assert.equal(result.size, 1);
  assert.ok(result.has("videos.title"));
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

// --- セキュリティ: collaborator に危険キーが含まれない ---

test("COLLABORATOR_VIDEO_EDIT_KEYS に危険キーが含まれない", () => {
  for (const k of DANGEROUS_ADMIN_VIDEO_EDIT_KEYS) {
    assert.equal(
      COLLABORATOR_VIDEO_EDIT_KEYS.has(k),
      false,
      `Collaborator key "${k}" should NOT be in dangerous admin set`,
    );
  }
});

test("COLLABORATOR_VIDEO_EDIT_KEYS に identity/youtube_id/primary_event/status/chapter_admin が含まれない", () => {
  const dangerousKeys = [
    "video.identity", "video.youtube_id", "video.primary_event",
    "video.status", "video.chapter_admin",
    "videos.youtube_id", "videos.primary_event",
  ];
  for (const k of dangerousKeys) {
    assert.equal(
      COLLABORATOR_VIDEO_EDIT_KEYS.has(k),
      false,
      `"${k}" must NOT be collaborator-editable`,
    );
  }
});

// --- セキュリティ: USER_DELEGATABLE に危険キーが含まれない ---

test("USER_DELEGATABLE_KEYS に危険キーが含まれない", () => {
  for (const k of DANGEROUS_ADMIN_VIDEO_EDIT_KEYS) {
    assert.equal(
      USER_DELEGATABLE_KEYS.has(k),
      false,
      `Delegatable key "${k}" should NOT be dangerous`,
    );
  }
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

// --- decideCanEditVideo normal (通常モード 7-11) ---

test("decideCanEditVideo normal: 所有者はデフォルト一般作品権限の safe キーを許可", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideNormal({ ownership, requiredKey: "video.basics" }),
    true,
  );
  assert.equal(
    decideNormal({ ownership, requiredKey: "video.descriptions" }),
    true,
  );
});

test("decideCanEditVideo normal: 所有者でもエイリアス無し危険キーは拒否", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  const deniedWithoutAlias = [
    "video.youtube_id",
    "videos.youtube_id",
    "video.primary_event",
    "videos.primary_event",
    "video.status",
  ];
  for (const k of deniedWithoutAlias) {
    assert.equal(
      decideNormal({ ownership, requiredKey: k }),
      false,
      `${k} must be denied in normal mode for owner`,
    );
  }
});

test("decideCanEditVideo normal: video.identity は videos.title エイリアス経路でも拒否", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideNormal({ ownership, requiredKey: "video.identity" }),
    false,
  );
});

test("decideCanEditVideo normal: 非所有者は safe キーでも拒否", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideNormal({ ownership, requiredKey: "video.basics" }),
    false,
  );
  assert.equal(
    decideNormal({ ownership, requiredKey: "video.descriptions" }),
    false,
  );
});

test("decideCanEditVideo normal: イベントスタッフ相当フラグは通常モードで無視 (拒否)", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideNormal({
      ownership,
      requiredKey: "video.basics",
      eventStaffAllows: true,
    }),
    false,
  );
});

test("decideCanEditVideo normal: 限定一般作品権限はポリシー外キーを拒否", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  const limited = new Set(["videos.title"]);
  assert.equal(
    decideNormal({
      ownership,
      requiredKey: "videos.title",
      ownerPolicyKeys: limited,
    }),
    true,
  );
  assert.equal(
    decideNormal({
      ownership,
      requiredKey: "video.descriptions",
      ownerPolicyKeys: limited,
    }),
    false,
  );
});

// --- decideCanEditVideo event (イベント運営 12-16) ---

test("decideCanEditVideo event: eventStaffAllows true なら非所有者も許可", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideEvent({
      ownership,
      requiredKey: "video.basics",
      eventStaffAllows: true,
    }),
    true,
  );
});

test("decideCanEditVideo event: eventStaffAllows false なら所有者でも拒否", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideEvent({
      ownership,
      requiredKey: "video.basics",
      eventStaffAllows: false,
    }),
    false,
  );
});

test("decideCanEditVideo event: 危険キーも eventStaffAllows で許可", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideEvent({
      ownership,
      requiredKey: "video.identity",
      eventStaffAllows: true,
    }),
    true,
  );
  assert.equal(
    decideEvent({
      ownership,
      requiredKey: "video.status",
      eventStaffAllows: true,
    }),
    true,
  );
});

test("decideCanEditVideo event: site admin ロールでも eventStaffAllows 必須", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideEvent({
      ownership,
      requiredKey: "video.status",
      userRole: "admin",
      eventStaffAllows: false,
    }),
    false,
  );
});

test("decideCanEditVideo event: eventStaffAllows false で危険キーも拒否", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideEvent({
      ownership,
      requiredKey: "video.youtube_id",
      eventStaffAllows: false,
    }),
    false,
  );
});

// --- decideCanEditVideo admin (管理者 17-19) ---

test("decideCanEditVideo admin: site admin は admin モードで safe キーを許可", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: [],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideAdmin({ ownership, requiredKey: "video.basics" }),
    true,
  );
});

test("decideCanEditVideo admin: site admin は admin モードで危険キーも許可", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: [],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideAdmin({ ownership, requiredKey: "video.identity" }),
    true,
  );
  assert.equal(
    decideAdmin({ ownership, requiredKey: "video.permissions" }),
    true,
  );
});

test("decideCanEditVideo admin: site admin でも normal モードでは admin 特権なし", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideNormal({
      ownership,
      requiredKey: "video.status",
      userRole: "admin",
    }),
    false,
  );
  assert.equal(
    decideNormal({
      ownership,
      requiredKey: "video.youtube_id",
      userRole: "admin",
    }),
    false,
  );
});

test("decideCanEditVideo admin: 非 admin ロールは admin モードで拒否", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: [],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideAdmin({
      ownership,
      requiredKey: "video.basics",
      userRole: "user",
    }),
    false,
  );
});

// --- creatorOwnerCanManagePermissions (共同編集 20-22) ---

test("creatorOwnerCanManagePermissions: 作者所有者は video.permissions を許可", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    creatorOwnerCanManagePermissions(ownership, "video.permissions"),
    true,
  );
  assert.equal(
    decideNormal({ ownership, requiredKey: "video.permissions" }),
    true,
  );
});

test("creatorOwnerCanManagePermissions: 合作所有者のみは video.permissions を拒否", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: true,
  });
  assert.equal(ownership.isOwner, true);
  assert.equal(ownership.isCreatorOwner, false);
  assert.equal(
    creatorOwnerCanManagePermissions(ownership, "video.permissions"),
    false,
  );
  assert.equal(
    decideNormal({ ownership, requiredKey: "video.permissions" }),
    false,
  );
});

test("creatorOwnerCanManagePermissions: 作者所有者は一般作品権限外でも permissions 許可", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideNormal({
      ownership,
      requiredKey: "video.permissions",
      ownerPolicyKeys: new Set(),
    }),
    true,
  );
});

// --- resolveOwnerGeneralPolicyKeys (複数イベント 24-25 / policy fail-closed) ---

test("resolveOwnerGeneralPolicyKeys: primary 無しまたは allow !== 1 はデフォルトポリシー", () => {
  const noEvent = resolveOwnerGeneralPolicyKeys({ primaryEvent: null });
  assert.deepEqual(noEvent, DEFAULT_OWNER_GENERAL_POLICY_KEYS);

  const disallowed = resolveOwnerGeneralPolicyKeys({
    primaryEvent: {
      allow_user_video_edits: 0,
      user_video_edit_permission_keys_json: JSON.stringify(["videos.title"]),
    },
  });
  assert.deepEqual(disallowed, DEFAULT_OWNER_GENERAL_POLICY_KEYS);

  const undefinedAllow = resolveOwnerGeneralPolicyKeys({
    primaryEvent: {
      allow_user_video_edits: null,
      user_video_edit_permission_keys_json: null,
    },
  });
  assert.deepEqual(undefinedAllow, DEFAULT_OWNER_GENERAL_POLICY_KEYS);
});

test("resolveOwnerGeneralPolicyKeys: allow=1 は JSON ホワイトリストのみ (primary 正本)", () => {
  const keys = resolveOwnerGeneralPolicyKeys({
    primaryEvent: {
      allow_user_video_edits: 1,
      user_video_edit_permission_keys_json: JSON.stringify([
        "videos.title",
        "video.descriptions",
      ]),
    },
  });
  assert.equal(keys.size, 2);
  assert.ok(keys.has("videos.title"));
  assert.ok(keys.has("video.descriptions"));
  assert.ok(!keys.has("video.members"));
});

test("resolveOwnerGeneralPolicyKeys: allow=1 で空 JSON は何も許可しない (fail-closed)", () => {
  const keys = resolveOwnerGeneralPolicyKeys({
    primaryEvent: {
      allow_user_video_edits: 1,
      user_video_edit_permission_keys_json: "[]",
    },
  });
  assert.equal(keys.size, 0);
});

test("resolveOwnerGeneralPolicyKeys: 危険キーと非ホワイトリストは JSON から除外", () => {
  const keys = resolveOwnerGeneralPolicyKeys({
    primaryEvent: {
      allow_user_video_edits: 1,
      user_video_edit_permission_keys_json: JSON.stringify([
        "video.identity",
        "videos.youtube_id",
        "not.a.real.key",
        "video.descriptions",
      ]),
    },
  });
  assert.equal(keys.size, 1);
  assert.ok(keys.has("video.descriptions"));
});

test("ownerGeneralPolicyAllows: エイリアス経由で許可 (videos.title → video.basics)、危険キーは拒否", () => {
  const policy = new Set(["videos.title"]);
  assert.equal(ownerGeneralPolicyAllows(policy, "video.basics"), true);
  assert.equal(ownerGeneralPolicyAllows(policy, "video.identity"), false);
  assert.equal(ownerGeneralPolicyAllows(policy, "video.youtube_id"), false);
});

test("adminPolicyAllows: admin 以外は拒否", () => {
  assert.equal(adminPolicyAllows("user", "video.basics"), false);
  assert.equal(adminPolicyAllows(null, "video.basics"), false);
});

test("adminPolicyAllows: admin は既知キーを許可", () => {
  assert.equal(adminPolicyAllows("admin", "video.basics"), true);
  assert.equal(adminPolicyAllows("admin", "video.identity"), true);
});

test("OWNER_GENERAL_POLICY_WHITELIST に危険キーと permissions が含まれない", () => {
  for (const k of DANGEROUS_ADMIN_VIDEO_EDIT_KEYS) {
    assert.equal(
      OWNER_GENERAL_POLICY_WHITELIST.has(k),
      false,
      `"${k}" must not be in owner general whitelist`,
    );
  }
  assert.equal(OWNER_GENERAL_POLICY_WHITELIST.has("video.permissions"), false);
});
