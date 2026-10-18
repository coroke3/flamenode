import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAllowedVideoFieldChanges,
  buildVideoAuditSnapshot,
  firstMissingRequiredVideoField,
  missingRequiredVideoFieldMessage,
  nextVideoAppLikeCount,
  unionRequiredVideoFields,
} from "@flamenode/domain/video";

test("required fields (SA-086/088/089): event union and first missing field", () => {
  assert.deepEqual(unionRequiredVideoFields(['["music"]', '["youtube_url","music"]', null]), ["music", "youtube_url"]);
  assert.equal(firstMissingRequiredVideoField(["music"], { music: " " }), "music");
  assert.equal(firstMissingRequiredVideoField(["music"], { music: " " }, new Set()), null);
  assert.equal(missingRequiredVideoFieldMessage("music"), "「使用楽曲」は必須です。");
});

const sections = (allowed) => ({
  identity: allowed, basics: allowed, youtube: allowed, credits: allowed,
  descriptions: allowed, members: allowed, member_chapters: allowed, primary_event: allowed,
});
const row = { title: "t", youtube_video_id: "abc", display_name: "d" };

test("field change guard (SA-089): denied sections reject changes, unchanged rows pass", () => {
  assert.deepEqual(
    assertAllowedVideoFieldChanges({ sections: sections(false), before: row, after: row, privilegeMode: "event" }),
    { ok: true },
  );
  assert.deepEqual(
    assertAllowedVideoFieldChanges({ sections: sections(false), before: row, after: { ...row, title: "x" }, privilegeMode: "event" }),
    { ok: false, message: "作品タイトルを編集する権限がありません。" },
  );
  assert.deepEqual(
    assertAllowedVideoFieldChanges({ sections: sections(false), before: row, after: { ...row, youtube_video_id: " abc " }, privilegeMode: "event" }),
    { ok: true },
  );
  assert.deepEqual(
    assertAllowedVideoFieldChanges({ sections: sections(true), before: row, after: { ...row, title: "x" }, privilegeMode: "normal", editableFields: new Set(["music"]) }),
    { ok: false, message: "作品タイトルを編集する権限がありません。" },
  );
  assert.deepEqual(
    assertAllowedVideoFieldChanges({ sections: sections(true), before: row, after: row, privilegeMode: "admin", submitterChangeRequested: true }),
    { ok: false, message: "提出主体 X ID の変更には管理者権限が必要です。" },
  );
});

test("audit snapshot (SA-089) uses the fallback software label", () => {
  const snapshot = buildVideoAuditSnapshot({ title: "t", creator_display_name: "n" }, undefined, "Blender");
  assert.equal(snapshot.used_software, "Blender");
  assert.equal(snapshot.display_name, "n");
});

test("like count (SA-087) never goes negative", () => {
  assert.equal(nextVideoAppLikeCount(0, true), 1);
  assert.equal(nextVideoAppLikeCount(3, false), 2);
  assert.equal(nextVideoAppLikeCount(0, false), 0);
});
