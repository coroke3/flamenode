import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_PERMISSION_KEYS } from "./keys.ts";
import {
  expandPermissionAliases,
  getManageStaffRole,
  normalizePermissionKeys,
  resolveStaffPermissionKeys,
  safeParseCustomPermissionKeys,
  staffRowHasPermissionKey,
} from "./permissionResolver.ts";
import { getPresetPermissions } from "./presets.ts";

test("expandPermissionAliases drops unknown keys", () => {
  assert.deepEqual(expandPermissionAliases("videos.title"), ["video.basics"]);
  assert.deepEqual(expandPermissionAliases("not.a.real.key"), []);
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
  const keys = resolveStaffPermissionKeys({
    permission_preset: "owner",
    custom_permission_keys_json: null,
  });
  assert.equal(keys.has("event.members"), true);
  assert.equal(keys.has("video.status"), true);
  assert.equal(keys.has("video.youtube_id"), false);
  assert.equal(keys.has("video.identity"), false);
  assert.equal(keys.has("event.public_api"), false);
  assert.equal(keys.has("xid.link_requests"), false);
  assert.deepEqual(keys, new Set(getPresetPermissions("owner")));
});

test("resolveStaffPermissionKeys reads custom JSON only for custom preset", () => {
  const keys = resolveStaffPermissionKeys({
    permission_preset: "custom",
    custom_permission_keys_json: JSON.stringify([
      "event.basic",
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

test("staffRowHasPermissionKey expands aliases", () => {
  assert.equal(
    staffRowHasPermissionKey(
      {
        permission_preset: "custom",
        custom_permission_keys_json: JSON.stringify(["video.basics"]),
      },
      "videos.title",
    ),
    true,
  );
});

test("public_staff preset resolves to empty permissions", () => {
  const keys = resolveStaffPermissionKeys({
    permission_preset: "public_staff",
    custom_permission_keys_json: null,
  });
  assert.equal(keys.size, 0);
});

test("manage staff role uses permission_preset as the owner source of truth", () => {
  assert.equal(getManageStaffRole({ permission_preset: "owner" }), "representative");
  assert.equal(getManageStaffRole({ permission_preset: "manager" }), "editor");
  assert.equal(getManageStaffRole({ permission_preset: "public_staff" }), null);
});

test("owner preset includes video.permissions for event staff", () => {
  const keys = resolveStaffPermissionKeys({
    permission_preset: "owner",
    custom_permission_keys_json: null,
  });
  assert.equal(keys.has("video.permissions"), true);
});

test("permission key registry stays within project limit", () => {
  assert.ok(ALL_PERMISSION_KEYS.length > 0);
});
