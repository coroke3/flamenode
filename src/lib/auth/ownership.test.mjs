import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VIDEO_PERMISSION_ALIASES,
  NORMAL_SAFE_VIDEO_EDIT_KEYS,
  DANGEROUS_ADMIN_VIDEO_EDIT_KEYS,
  COLLABORATOR_VIDEO_EDIT_KEYS,
  USER_DELEGATABLE_KEYS,
  DEFAULT_OWNER_GENERAL_POLICY_KEYS,
  shouldWarnManageActiveXMismatch,
  isSafeNormalVideoEditKey,
  isDangerousAdminVideoEditKey,
  isUserDelegatableKey,
  parseDelegatablePermissionKeys,
  resolveAdminOrEventVideoPrivilegeMode,
  resolveVideoOwnershipSync,
  decideCanEditVideo,
  adminPolicyAllows,
} from "./ownershipCore.ts";

// --- VIDEO_PERMISSION_ALIASES ---

test("VIDEO_PERMISSION_ALIASES: video.basics → video.basics + videos.title", () => {
  const aliases = VIDEO_PERMISSION_ALIASES["video.basics"];
  assert.ok(aliases.includes("video.basics"));
  assert.ok(aliases.includes("videos.title"));
});

test("VIDEO_PERMISSION_ALIASES: video.identity は自分自身のみ (videos.title とは非連携)", () => {
  assert.deepEqual(VIDEO_PERMISSION_ALIASES["video.identity"], ["video.identity"]);
  assert.ok(!VIDEO_PERMISSION_ALIASES["video.identity"].includes("videos.title"));
});

test("VIDEO_PERMISSION_ALIASES: videos.title → videos.title + video.basics (video.identity は含まない)", () => {
  const aliases = VIDEO_PERMISSION_ALIASES["videos.title"];
  assert.ok(aliases.includes("videos.title"));
  assert.ok(aliases.includes("video.basics"));
  assert.ok(!aliases.includes("video.identity"));
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

test("VIDEO_PERMISSION_ALIASES: video.descriptions ↔ videos.review_data 双方向", () => {
  assert.ok(VIDEO_PERMISSION_ALIASES["video.descriptions"].includes("videos.review_data"));
  assert.ok(VIDEO_PERMISSION_ALIASES["videos.review_data"].includes("video.descriptions"));
});

test("VIDEO_PERMISSION_ALIASES: video.credits ↔ videos.music_credit 双方向", () => {
  assert.ok(VIDEO_PERMISSION_ALIASES["video.credits"].includes("videos.music_credit"));
  assert.ok(VIDEO_PERMISSION_ALIASES["videos.music_credit"].includes("video.credits"));
});

test("VIDEO_PERMISSION_ALIASES: video.members ↔ videos.members 双方向", () => {
  assert.ok(VIDEO_PERMISSION_ALIASES["video.members"].includes("videos.members"));
  assert.ok(VIDEO_PERMISSION_ALIASES["videos.members"].includes("video.members"));
});

// --- NORMAL_SAFE_VIDEO_EDIT_KEYS ---

test("NORMAL_SAFE_VIDEO_EDIT_KEYS に危険キーが含まれない", () => {
  assert.ok(!NORMAL_SAFE_VIDEO_EDIT_KEYS.has("video.identity"));
  assert.ok(!NORMAL_SAFE_VIDEO_EDIT_KEYS.has("video.youtube_id"));
  assert.ok(!NORMAL_SAFE_VIDEO_EDIT_KEYS.has("video.primary_event"));
  assert.ok(!NORMAL_SAFE_VIDEO_EDIT_KEYS.has("video.status"));
  assert.ok(!NORMAL_SAFE_VIDEO_EDIT_KEYS.has("video.chapter_admin"));
  assert.ok(!NORMAL_SAFE_VIDEO_EDIT_KEYS.has("videos.youtube_id"));
  assert.ok(!NORMAL_SAFE_VIDEO_EDIT_KEYS.has("videos.primary_event"));
});

test("NORMAL_SAFE_VIDEO_EDIT_KEYS に合作関連キーが含まれる", () => {
  assert.ok(isSafeNormalVideoEditKey("video.descriptions"));
  assert.ok(isSafeNormalVideoEditKey("video.members"));
  assert.ok(isSafeNormalVideoEditKey("video.credits"));
  assert.ok(isSafeNormalVideoEditKey("video.member_chapters"));
});

// --- DANGEROUS_ADMIN_VIDEO_EDIT_KEYS ---

test("DANGEROUS_ADMIN_VIDEO_EDIT_KEYS に危険キーが全て含まれる", () => {
  assert.ok(isDangerousAdminVideoEditKey("video.identity"));
  assert.ok(isDangerousAdminVideoEditKey("video.youtube_id"));
  assert.ok(isDangerousAdminVideoEditKey("video.primary_event"));
  assert.ok(isDangerousAdminVideoEditKey("video.status"));
  assert.ok(isDangerousAdminVideoEditKey("video.chapter_admin"));
  assert.ok(isDangerousAdminVideoEditKey("videos.youtube_id"));
  assert.ok(isDangerousAdminVideoEditKey("videos.primary_event"));
});

test("DANGEROUS_ADMIN_VIDEO_EDIT_KEYS に合作キーが含まれない", () => {
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("video.descriptions") || !isDangerousAdminVideoEditKey("video.descriptions"));
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("video.members") || !isDangerousAdminVideoEditKey("video.members"));
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("video.credits") || !isDangerousAdminVideoEditKey("video.credits"));
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("video.member_chapters") || !isDangerousAdminVideoEditKey("video.member_chapters"));
});

// --- COLLABORATOR_VIDEO_EDIT_KEYS ---

test("COLLABORATOR_VIDEO_EDIT_KEYS に危険キーが含まれない", () => {
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("video.identity"));
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("video.youtube_id"));
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("video.primary_event"));
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("video.status"));
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("video.chapter_admin"));
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("videos.youtube_id"));
  assert.ok(!COLLABORATOR_VIDEO_EDIT_KEYS.has("videos.primary_event"));
});

test("COLLABORATOR_VIDEO_EDIT_KEYS に合作関連キーが含まれる", () => {
  assert.ok(COLLABORATOR_VIDEO_EDIT_KEYS.has("video.descriptions"));
  assert.ok(COLLABORATOR_VIDEO_EDIT_KEYS.has("video.members"));
  assert.ok(COLLABORATOR_VIDEO_EDIT_KEYS.has("videos.review_data"));
  assert.ok(COLLABORATOR_VIDEO_EDIT_KEYS.has("videos.members"));
  assert.ok(COLLABORATOR_VIDEO_EDIT_KEYS.has("video.credits"));
  assert.ok(COLLABORATOR_VIDEO_EDIT_KEYS.has("videos.music_credit"));
});

// --- USER_DELEGATABLE_KEYS ---

test("USER_DELEGATABLE_KEYS に危険キーが含まれない", () => {
  assert.ok(!isUserDelegatableKey("video.identity"));
  assert.ok(!isUserDelegatableKey("video.youtube_id"));
  assert.ok(!isUserDelegatableKey("video.primary_event"));
  assert.ok(!isUserDelegatableKey("video.status"));
  assert.ok(!isUserDelegatableKey("video.chapter_admin"));
  assert.ok(!isUserDelegatableKey("videos.youtube_id"));
  assert.ok(!isUserDelegatableKey("videos.primary_event"));
});

test("USER_DELEGATABLE_KEYS に videos.title が含まれる", () => {
  assert.ok(isUserDelegatableKey("videos.title"));
});

test("USER_DELEGATABLE_KEYS に合作関連キーが含まれる", () => {
  assert.ok(isUserDelegatableKey("video.descriptions"));
  assert.ok(isUserDelegatableKey("video.members"));
  assert.ok(isUserDelegatableKey("video.credits"));
  assert.ok(isUserDelegatableKey("videos.music_credit"));
  assert.ok(isUserDelegatableKey("videos.members"));
  assert.ok(isUserDelegatableKey("videos.review_data"));
});

// --- shouldWarnManageActiveXMismatch ---

test("shouldWarnManageActiveXMismatch: activeX が null なら false", () => {
  assert.equal(shouldWarnManageActiveXMismatch(null, ["x1"]), false);
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

test("parseDelegatablePermissionKeys: null → 空 Set", () => {
  assert.equal(parseDelegatablePermissionKeys(null).size, 0);
});

test("parseDelegatablePermissionKeys: 不正 JSON → 空 Set", () => {
  assert.equal(parseDelegatablePermissionKeys("{invalid").size, 0);
});

test("parseDelegatablePermissionKeys: 有効な delegatable キー → Set", () => {
  const result = parseDelegatablePermissionKeys('["videos.title", "video.descriptions"]');
  assert.ok(result.has("videos.title"));
  assert.ok(result.has("video.descriptions"));
});

test("parseDelegatablePermissionKeys: 危険キーは除外される", () => {
  const result = parseDelegatablePermissionKeys('["videos.youtube_id", "video.identity"]');
  assert.equal(result.size, 0);
});

// --- privilegeMode の分離確認 ---

test("privilegeMode: normal と dangerous キー集合は重複しない", () => {
  const safeKeys = Array.from(NORMAL_SAFE_VIDEO_EDIT_KEYS);
  const overlap = safeKeys.filter((k) => isDangerousAdminVideoEditKey(k));
  assert.equal(overlap.length, 0, "safe と dangerous が重複していない");
});

test("privilegeMode: 合作所有者のデフォルト許可は一般作品権限 (危険キー除外)", () => {
  const collabKeys = Array.from(COLLABORATOR_VIDEO_EDIT_KEYS);
  const dangerousOverlap = collabKeys.filter((k) =>
    isDangerousAdminVideoEditKey(k),
  );
  assert.equal(
    dangerousOverlap.length,
    0,
    "collaborator 許可キーに危険キーが含まれない",
  );
  assert.deepEqual(COLLABORATOR_VIDEO_EDIT_KEYS, DEFAULT_OWNER_GENERAL_POLICY_KEYS);
});

test("privilegeMode: site admin でも normal モードでは admin 特権を使わない", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideCanEditVideo({
      privilegeMode: "normal",
      userRole: "admin",
      ownership,
      requiredKey: "video.status",
      ownerPolicyKeys: DEFAULT_OWNER_GENERAL_POLICY_KEYS,
      eventStaffAllows: false,
    }),
    false,
  );
});

test("privilegeMode: 非所有者に一般作品権限は適用されない", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideCanEditVideo({
      privilegeMode: "normal",
      userRole: "user",
      ownership,
      requiredKey: "video.basics",
      ownerPolicyKeys: DEFAULT_OWNER_GENERAL_POLICY_KEYS,
      eventStaffAllows: false,
    }),
    false,
  );
});

test("privilegeMode: can_edit 合作は所有者 (isCollaboratorOwner)", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x2"],
    creatorXUserId: "x1",
    hasCollaboratorEdit: true,
  });
  assert.equal(ownership.isOwner, true);
  assert.equal(ownership.isCollaboratorOwner, true);
  assert.equal(ownership.isCreatorOwner, false);
});

test("ownership.ts: normal モードで eventStaffHasExactVideoPermission を呼ばない", () => {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  const normalBlock = source.match(
    /if \(privilegeMode === "normal"\)\s*\{[\s\S]*?\}\s*else if \(privilegeMode === "event"\)/,
  )?.[0];
  assert.ok(normalBlock, "normal privilege block not found");
  assert.doesNotMatch(
    normalBlock,
    /eventStaffHasExactVideoPermission/,
    "normal モードにイベントスタッフ経路が残っている",
  );
});

test("ownership.ts: normal モードは非所有者を早期拒否する", () => {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  const normalBlock = source.match(
    /if \(privilegeMode === "normal"\)\s*\{[\s\S]*?\}\s*else if \(privilegeMode === "event"\)/,
  )?.[0];
  assert.ok(normalBlock, "normal privilege block not found");
  assert.match(normalBlock, /if \(!ownership\.isOwner\) return false/);
});

test("ownership.ts: loadPrimaryEventOwnerPolicy は primary_event 正本のみ", () => {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  const loadBody = source.match(
    /async function loadPrimaryEventOwnerPolicy[\s\S]*?^}/m,
  )?.[0];
  assert.ok(loadBody, "loadPrimaryEventOwnerPolicy not found");
  assert.doesNotMatch(loadBody, /videoEvents/);
  assert.match(loadBody, /primaryEventId/);
});

test("privilegeMode: admin/event 併用入口はロールごとに単一モードへ分離する", () => {
  assert.equal(resolveAdminOrEventVideoPrivilegeMode("admin"), "admin");
  assert.equal(resolveAdminOrEventVideoPrivilegeMode("moderator"), "event");
  assert.equal(resolveAdminOrEventVideoPrivilegeMode("user"), "event");
  assert.equal(resolveAdminOrEventVideoPrivilegeMode(null), "event");
});

test("privilegeMode: any・省略可能引数・暗黙defaultを再導入しない", () => {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CanEditVideoPrivilegeMode[^;]+"any"/);
  assert.doesNotMatch(source, /privilegeMode\?\s*:/);
  assert.doesNotMatch(source, /privilegeMode\s*\?\?\s*/);
});

test("privilegeMode: adminPolicyAllows は admin ロールのみ既知キーを許可", () => {
  assert.equal(adminPolicyAllows("admin", "video.status"), true);
  assert.equal(adminPolicyAllows("admin", "video.identity"), true);
  assert.equal(adminPolicyAllows("user", "video.status"), false);
  assert.equal(adminPolicyAllows("moderator", "video.basics"), false);
});

test("privilegeMode: decideCanEditVideo admin モードは adminPolicyAllows に委譲", () => {
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: ["x1"],
    creatorXUserId: "x2",
    hasCollaboratorEdit: false,
  });
  assert.equal(
    decideCanEditVideo({
      privilegeMode: "admin",
      userRole: "admin",
      ownership,
      requiredKey: "video.status",
      ownerPolicyKeys: new Set(),
      eventStaffAllows: false,
    }),
    true,
  );
  assert.equal(
    decideCanEditVideo({
      privilegeMode: "admin",
      userRole: "user",
      ownership,
      requiredKey: "video.status",
      ownerPolicyKeys: new Set(),
      eventStaffAllows: false,
    }),
    false,
  );
});

test("canEditVideo: normal モードで event staff バイパスを使わない", () => {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getEditableEventIds\(db, user\.id\)/);
  assert.doesNotMatch(source, /isEventDelegationGranted/);
  assert.doesNotMatch(source, /COLLABORATOR_VIDEO_EDIT_KEYS\.has/);
});

test("canEditVideo: normal モードは general fields で section 判定", () => {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  assert.match(source, /loadGeneralEditableFieldSet/);
  assert.match(source, /sectionAllowedByGeneralFields/);
  assert.doesNotMatch(
    source,
    /approved\.includes\(video\.creator_x_user_id\)[\s\S]*return true/,
  );
});
