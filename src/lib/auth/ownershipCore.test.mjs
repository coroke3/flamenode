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
  isSafeNormalVideoEditKey,
  isDangerousAdminVideoEditKey,
  isUserDelegatableKey,
  shouldWarnManageActiveXMismatch,
  parseDelegatablePermissionKeys,
} from "./ownershipCore.ts";

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

test("parseDelegatablePermissionKeys: 不正 JSON なら空 Set (fail-open)", () => {
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
