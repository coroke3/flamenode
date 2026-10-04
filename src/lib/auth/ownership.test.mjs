import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VIDEO_PERMISSION_ALIASES,
  shouldWarnManageActiveXMismatch,
  resolveAdminOrEventVideoPrivilegeMode,
  resolveVideoOwnershipSync,
  adminPolicyAllows,
} from "./ownershipCore.ts";

/** canEditVideo の DB 経路のうち、通常モード (所有者) の判定部分。 */
function canEditVideoNormalBlock() {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  const normalBlock = source.match(
    /export async function canEditVideo\([\s\S]*?if \(privilegeMode !== "normal"\) return false;([\s\S]*?)\n}\r?\n/,
  )?.[1];
  assert.ok(normalBlock, "normal privilege block not found");
  return normalBlock;
}

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
  assert.doesNotMatch(
    canEditVideoNormalBlock(),
    /eventStaffHasExactVideoPermission/,
    "normal モードにイベントスタッフ経路が残っている",
  );
});

test("ownership.ts: normal モードは非所有者を早期拒否する", () => {
  assert.match(canEditVideoNormalBlock(), /if \(!ownership\.isOwner\) return false/);
});

test("ownership.ts: loadEffectiveOwnerEditableFieldSet は primary_event 正本のみ", () => {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  const loadBody = source.match(
    /export async function loadEffectiveOwnerEditableFieldSet[\s\S]*?^}/m,
  )?.[0];
  assert.ok(loadBody, "loadEffectiveOwnerEditableFieldSet not found");
  assert.doesNotMatch(loadBody, /videoEvents/);
  assert.match(loadBody, /primaryEventId/);
  // 一般 field の正本は field key だけ。旧 section key の既定集合を field 集合として扱わない。
  assert.doesNotMatch(loadBody, /resolveOwnerGeneralPolicyKeys/);
});

test("ownership.ts: event staff 判定は DB 経路と context 経路で同じ候補キーを使う", () => {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  const grantBody = source.match(
    /export async function eventStaffHasExactVideoPermission[\s\S]*?\n}\r?\n/,
  )?.[0];
  assert.ok(grantBody, "eventStaffHasExactVideoPermission not found");
  assert.match(grantBody, /eventStaffCandidatePermissionKeys\(args\.requiredKey\)/);
  const contextBody = source.match(
    /export async function resolveVideoEditAccessContext[\s\S]*?\n}\r?\n/,
  )?.[0];
  assert.ok(contextBody, "resolveVideoEditAccessContext not found");
  assert.match(contextBody, /resolveStaffPermissionKeys\(row\)/);
  // section 名を逆引きで足すと DB 経路より広く許可してしまう。
  assert.doesNotMatch(contextBody, /VIDEO_PERMISSION_ALIASES/);
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

test("canEditVideo: normal モードで event staff バイパスを使わない", () => {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /getEditableEventIds\(db, user\.id\)/);
  assert.doesNotMatch(source, /isEventDelegationGranted/);
  assert.doesNotMatch(source, /COLLABORATOR_VIDEO_EDIT_KEYS\.has/);
});

test("canEditVideo: normal モードは general fields で section 判定", () => {
  const source = readFileSync(new URL("./ownership.ts", import.meta.url), "utf8");
  assert.match(source, /loadGeneralEditableFieldSet/);
  assert.match(canEditVideoNormalBlock(), /loadEffectiveOwnerEditableFieldSet\(db, video\)/);
  assert.doesNotMatch(
    source,
    /approved\.includes\(video\.creator_x_user_id\)[\s\S]*return true/,
  );
});

test("canEditVideo: normal モードの youtube section も一般 field で判定する", () => {
  const normalBlock = canEditVideoNormalBlock();
  assert.match(normalBlock, /ownerPolicyAllows\(ownership, requiredKey, fields\)/);
  assert.doesNotMatch(normalBlock, /requiredKey === "video\.youtube_id"\) return false/);
});
