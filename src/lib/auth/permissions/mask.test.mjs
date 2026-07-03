import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_PERMISSION_KEYS } from "./keys.ts";
import {
  MAX_PERMISSION_KEYS_FOR_NUMBER_MASK,
  hasPermission,
  keysToPermissionMask,
  normalizePermissionKeys,
  permissionMaskToKeys,
  presetToPermissionMask,
  resolveStaffPermissionKeys,
  safeParseCustomPermissionKeys,
} from "./mask.ts";

test("permission mask key count stays within Number-safe project limit", () => {
  assert.ok(ALL_PERMISSION_KEYS.length <= MAX_PERMISSION_KEYS_FOR_NUMBER_MASK);
});

test("keysToPermissionMask does not use 32bit bit operators", () => {
  const mask = keysToPermissionMask(["video.status", "video.member_chapters"]);
  assert.equal(hasPermission(mask, "video.status"), true);
  assert.equal(hasPermission(mask, "video.member_chapters"), true);
  assert.deepEqual(permissionMaskToKeys(mask), [
    "video.member_chapters",
    "video.status",
  ]);
});

test("legacy permission keys are canonicalized one-way", () => {
  const keys = normalizePermissionKeys([
    "videos.title",
    "videos.music_credit",
    "video.chapter_admin",
  ]);
  assert.deepEqual(keys, [
    "video.basics",
    "video.credits",
    "video.member_chapters",
  ]);
});

test("adminOnly keys are filtered unless explicitly allowed", () => {
  assert.deepEqual(normalizePermissionKeys(["video.youtube_id"]), []);
  assert.deepEqual(
    normalizePermissionKeys(["video.youtube_id"], { allowAdminOnly: true }),
    ["video.youtube_id"],
  );
});

test("safeParseCustomPermissionKeys treats invalid JSON as empty", () => {
  assert.deepEqual(safeParseCustomPermissionKeys("{bad"), []);
  assert.deepEqual(safeParseCustomPermissionKeys('{"key":"value"}'), []);
});

test("owner preset excludes adminOnly keys", () => {
  const mask = presetToPermissionMask("owner", { allowAdminOnly: true });
  assert.equal(hasPermission(mask, "event.members"), true);
  assert.equal(hasPermission(mask, "video.status"), true);
  assert.equal(hasPermission(mask, "video.youtube_id"), false);
  assert.equal(hasPermission(mask, "video.identity"), false);
  assert.equal(hasPermission(mask, "event.public_api"), false);
  assert.equal(hasPermission(mask, "xid.link_requests"), false);
});

test("resolveStaffPermissionKeys merges mask and custom JSON safely", () => {
  const mask = keysToPermissionMask(["event.basic"]);
  const keys = resolveStaffPermissionKeys({
    permission_preset: "custom",
    permission_mask: mask,
    custom_permission_keys_json: JSON.stringify([
      "videos.review_data",
      "video.youtube_id",
      "unknown",
    ]),
  });
  assert.equal(keys.has("event.basic"), true);
  assert.equal(keys.has("video.descriptions"), true);
  assert.equal(keys.has("video.youtube_id"), true);
  assert.equal(keys.has("unknown"), false);
});
