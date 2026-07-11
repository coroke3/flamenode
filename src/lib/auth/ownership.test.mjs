import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_PERMISSION_ALIASES,
  NORMAL_SAFE_VIDEO_EDIT_KEYS,
  DANGEROUS_ADMIN_VIDEO_EDIT_KEYS,
  COLLABORATOR_VIDEO_EDIT_KEYS,
  USER_DELEGATABLE_KEYS,
  shouldWarnManageActiveXMismatch,
  isSafeNormalVideoEditKey,
  isDangerousAdminVideoEditKey,
  isUserDelegatableKey,
  parseDelegatablePermissionKeys,
} from "./ownershipCore.ts";

// --- VIDEO_PERMISSION_ALIASES ---

test("VIDEO_PERMISSION_ALIASES: video.basics → video.basics + videos.title", () => {
  const aliases = VIDEO_PERMISSION_ALIASES["video.basics"];
  assert.ok(aliases.includes("video.basics"));
  assert.ok(aliases.includes("videos.title"));
});

test("VIDEO_PERMISSION_ALIASES: video.identity → video.identity + videos.title", () => {
  const aliases = VIDEO_PERMISSION_ALIASES["video.identity"];
  assert.ok(aliases.includes("video.identity"));
  assert.ok(aliases.includes("videos.title"));
});

test("VIDEO_PERMISSION_ALIASES: videos.title → videos.title + video.basics + video.identity", () => {
  const aliases = VIDEO_PERMISSION_ALIASES["videos.title"];
  assert.ok(aliases.includes("videos.title"));
  assert.ok(aliases.includes("video.basics"));
  assert.ok(aliases.includes("video.identity"));
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

test("privilegeMode: normal モードでは admin でも safe key だけ", () => {
  const safeKeys = Array.from(NORMAL_SAFE_VIDEO_EDIT_KEYS);
  const overlap = safeKeys.filter((k) => isDangerousAdminVideoEditKey(k));
  assert.equal(overlap.length, 0, "safe と dangerous が重複していない");
});

test("privilegeMode: collaborator のデフォルト許可キーは合作系のみ", () => {
  const collabKeys = Array.from(COLLABORATOR_VIDEO_EDIT_KEYS);
  const dangerousOverlap = collabKeys.filter((k) => isDangerousAdminVideoEditKey(k));
  assert.equal(dangerousOverlap.length, 0, "collaborator 許可キーに危険キーが含まれない");
});
