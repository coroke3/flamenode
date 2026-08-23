import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAllowedVideoFieldChanges } from "./assertAllowedVideoFieldChanges.ts";

function allSections(overrides = {}) {
  return {
    identity: true,
    basics: true,
    youtube: true,
    credits: true,
    descriptions: true,
    members: true,
    primary_event: true,
    ...overrides,
  };
}

function baseSnapshot(overrides = {}) {
  return {
    display_name: "name",
    icon_url: null,
    title: "title",
    youtube_video_id: "yt123",
    music: "music",
    credit: "credit",
    music_reference_url: null,
    intro_comment: "intro",
    highlights: null,
    production_story: null,
    used_software: "After Effects",
    stage_permission: null,
    closing_comment: null,
    is_collab: false,
    ...overrides,
  };
}

test("sections.basics=false で title 変更は拒否（UI disabled 相当）", () => {
  const before = baseSnapshot();
  const after = { ...before, title: "new title" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({ basics: false }),
    before,
    after,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, "作品タイトルを編集する権限がありません。");
  }
});

test("identity 権限なしで display_name 変更は拒否", () => {
  const before = baseSnapshot();
  const after = { ...before, display_name: "other" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({ identity: false }),
    before,
    after,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, "表示名を編集する権限がありません。");
  }
});

test("youtube 権限なしで YouTube ID 変更は拒否", () => {
  const before = baseSnapshot();
  const after = { ...before, youtube_video_id: "other" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({ youtube: false }),
    before,
    after,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, "YouTube ID を編集する権限がありません。");
  }
});

test("credits 権限なしで music 変更は拒否", () => {
  const before = baseSnapshot();
  const after = { ...before, music: "other" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({ credits: false }),
    before,
    after,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, "楽曲・クレジットを編集する権限がありません。");
  }
});

test("descriptions 権限なしで intro_comment 変更は拒否", () => {
  const before = baseSnapshot();
  const after = { ...before, intro_comment: "other" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({ descriptions: false }),
    before,
    after,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, "紹介文・振り返り項目を編集する権限がありません。");
  }
});

test("members 権限なしの is_collab 差分は拒否せず無視（disabled checkbox 誤送信）", () => {
  const before = baseSnapshot({ is_collab: true });
  const after = { ...before, is_collab: false, title: "new title" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({
      members: false,
      basics: true,
      identity: false,
      youtube: false,
      credits: false,
      descriptions: false,
    }),
    before,
    after,
  });
  assert.deepEqual(result, { ok: true });
});

test("権限のあるフィールドだけの変更は成功", () => {
  const before = baseSnapshot();
  const after = { ...before, title: "new title" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({
      identity: false,
      youtube: false,
      credits: false,
      descriptions: false,
      members: false,
      basics: true,
    }),
    before,
    after,
  });
  assert.deepEqual(result, { ok: true });
});

test("複数項目のうち1つでも不正なら全体拒否（部分許可しない）", () => {
  const before = baseSnapshot();
  const after = {
    ...before,
    title: "allowed change",
    youtube_video_id: "blocked change",
  };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({
      basics: true,
      youtube: false,
      identity: false,
      credits: false,
      descriptions: false,
      members: false,
    }),
    before,
    after,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, "YouTube ID を編集する権限がありません。");
  }
});

test("変更なしは全 section false でも成功", () => {
  const snapshot = baseSnapshot();
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({
      identity: false,
      basics: false,
      youtube: false,
      credits: false,
      descriptions: false,
      members: false,
    }),
    before: snapshot,
    after: { ...snapshot },
  });
  assert.deepEqual(result, { ok: true });
});

test("提出主体 X ID 変更要求で allowSubmitterChange=false は拒否", () => {
  const before = baseSnapshot();
  const after = { ...before };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections(),
    before,
    after,
    submitterChangeRequested: true,
    allowSubmitterChange: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, "提出主体 X ID の変更には管理者権限が必要です。");
  }
});
test("initial youtube attach exception is narrow", () => {
  const before = baseSnapshot({ youtube_video_id: null });
  const after = { ...before, youtube_video_id: "new-youtube-id" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({ youtube: true }),
    before,
    after,
    privilegeMode: "normal",
    editableFields: new Set(["title"]),
    allowInitialYoutubeAttach: true,
  });
  assert.deepEqual(result, { ok: true });
});

test("youtube field remains blocked without the initial attach exception", () => {
  const before = baseSnapshot({ youtube_video_id: null });
  const after = { ...before, youtube_video_id: "new-youtube-id" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({ youtube: true }),
    before,
    after,
    privilegeMode: "normal",
    editableFields: new Set(["title"]),
  });
  assert.equal(result.ok, false);
});

test("normal owner policy cannot turn into general YouTube replacement permission", () => {
  const before = baseSnapshot({ youtube_video_id: "old-youtube-id" });
  const after = { ...before, youtube_video_id: "replacement-id" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({ youtube: true }),
    before,
    after,
    privilegeMode: "normal",
    editableFields: new Set(["title"]),
  });
  assert.equal(result.ok, false);
});

test("normal owner YouTube policy allows replacement and clear", () => {
  const replacement = assertAllowedVideoFieldChanges({
    sections: allSections({ youtube: true }),
    before: baseSnapshot({ youtube_video_id: "old-youtube-id" }),
    after: baseSnapshot({ youtube_video_id: "new-youtube-id" }),
    privilegeMode: "normal",
    editableFields: new Set(["youtube_url"]),
  });
  assert.deepEqual(replacement, { ok: true });

  const clear = assertAllowedVideoFieldChanges({
    sections: allSections({ youtube: true }),
    before: baseSnapshot({ youtube_video_id: "old-youtube-id" }),
    after: baseSnapshot({ youtube_video_id: null }),
    privilegeMode: "normal",
    editableFields: new Set(["youtube_url"]),
  });
  assert.deepEqual(clear, { ok: true });
});

test("YouTube IDの前後空白だけでは権限外変更として扱わない", () => {
  const before = baseSnapshot({ youtube_video_id: "  yt123  " });
  const after = { ...before, youtube_video_id: "yt123" };
  const result = assertAllowedVideoFieldChanges({
    sections: allSections({ youtube: false }),
    before,
    after,
    privilegeMode: "normal",
    editableFields: new Set(["title"]),
  });
  assert.deepEqual(result, { ok: true });
});
