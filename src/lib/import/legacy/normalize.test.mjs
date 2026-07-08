import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeEventInfo, normalizeLegacyVideo, detectLegacyKind } from "./normalize.ts";

describe("detectLegacyKind", () => {
  it("detects events", () => {
    assert.equal(detectLegacyKind([{ eventid: "ev1", eventname: "Test", start: "2024-01-01" }]), "events");
  });

  it("detects videos", () => {
    assert.equal(detectLegacyKind([{ tlink: "alice", ylink: "https://youtu.be/abc", title: "vid" }]), "videos");
  });

  it("returns unknown for empty array", () => {
    assert.equal(detectLegacyKind([]), "unknown");
  });
});

describe("normalizeEventInfo", () => {
  it("normalizes a basic event", () => {
    const result = normalizeEventInfo(
      { eventid: "event1", eventname: "テストイベント", start: "2024-01-01" },
      { importMode: "archive", now: 1700000000 },
    );
    assert.ok(result.ok);
    assert.equal(result.event?.id, "event1");
    assert.equal(result.event?.title, "テストイベント");
    assert.equal(result.event?.visibility_status, "archived");
    // is_active / is_entry_open / is_archived は出力しない
    assert.ok(!("is_active" in (result.event ?? {})));
    assert.ok(!("is_entry_open" in (result.event ?? {})));
    assert.ok(!("is_archived" in (result.event ?? {})));
  });

  it("returns ok=false for empty eventid", () => {
    const result = normalizeEventInfo({ eventid: "" });
    assert.ok(!result.ok);
  });

  it("parses member list and sets representative", () => {
    const result = normalizeEventInfo({
      eventid: "ev1",
      eventname: "Test",
      member: "主催者,スタッフ",
      memberid: "host_user,staff_user",
      memberpost: "主催,スタッフ",
    });
    assert.ok(result.ok);
    assert.equal(result.editors.length, 2);
    const rep = result.editors.find((e) => e.is_representative_candidate);
    assert.ok(rep);
    assert.equal(rep.x_user_id, "host_user");
  });

  it("preserve mode: sets public visibility for active event", () => {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 3600; // 1 hour ago
    const end = now + 3600; // 1 hour from now
    const result = normalizeEventInfo(
      {
        eventid: "active_ev",
        eventname: "Active",
        start: String(start),
        end: String(end),
      },
      { importMode: "preserve", now },
    );
    assert.ok(result.ok);
    assert.equal(result.event?.visibility_status, "public");
  });
});

describe("normalizeLegacyVideo", () => {
  it("normalizes a basic video", () => {
    const result = normalizeLegacyVideo({
      eventid: "ev1",
      title: "テスト動画",
      tlink: "creator_x",
      ylink: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    assert.ok(result.ok);
    assert.equal(result.video?.creator_x_user_id, "creator_x");
    assert.equal(result.video?.youtube_video_id, "dQw4w9WgXcQ");
    assert.ok(result.video?.id.startsWith("legacy_dQw4w9WgXcQ"));
    // stage_permission / used_software は video に含まれない
    assert.ok(!("stage_permission" in (result.video ?? {})));
    assert.ok(!("used_software" in (result.video ?? {})));
  });

  it("maps righttype to legacyCustomAnswers.stage_permission", () => {
    const result = normalizeLegacyVideo({
      title: "動画",
      tlink: "user1",
      righttype: "あり",
    });
    assert.ok(result.ok);
    const ans = result.video?.legacyCustomAnswers.find((a) => a.key === "stage_permission");
    assert.ok(ans);
    assert.equal(ans.value, "あり");
  });

  it("maps toudan to legacyCustomAnswers.stage_participation", () => {
    const result = normalizeLegacyVideo({ title: "動画", tlink: "user1", toudan: "参加" });
    assert.ok(result.ok);
    const ans = result.video?.legacyCustomAnswers.find((a) => a.key === "stage_participation");
    assert.ok(ans);
  });

  it("maps movieyear to legacyCustomAnswers.production_experience", () => {
    const result = normalizeLegacyVideo({ title: "動画", tlink: "user1", movieyear: "3年" });
    assert.ok(result.ok);
    const ans = result.video?.legacyCustomAnswers.find((a) => a.key === "production_experience");
    assert.ok(ans);
  });

  it("puts soft field in softwareLabels", () => {
    const result = normalizeLegacyVideo({ title: "動画", tlink: "user1", soft: "Blender, CLIP STUDIO" });
    assert.ok(result.ok);
    assert.ok(result.video?.softwareLabels.includes("Blender"));
    assert.ok(result.video?.softwareLabels.includes("CLIP STUDIO"));
  });

  it("parses member starts into chapters_json", () => {
    const result = normalizeLegacyVideo({
      title: "合作",
      tlink: "main_creator",
      member: "Alice,Bob",
      memberid: "alice_x,bob_x",
      starts: [30, 120],
      ends: [120, 240],
    });
    assert.ok(result.ok);
    const alice = result.members.find((m) => m.x_user_id === "alice_x");
    assert.ok(alice?.chapters_json);
    const chapters = JSON.parse(alice.chapters_json);
    assert.equal(chapters[0].time_seconds, 30);
  });

  it("returns ok=false for missing tlink and title", () => {
    const result = normalizeLegacyVideo({ eventid: "ev1" });
    assert.ok(!result.ok);
  });

  it("uses a stable fallback video id when youtube id is missing", () => {
    const input = { title: "無YT動画", tlink: "creator_x", eventid: "ev1" };
    const a = normalizeLegacyVideo(input);
    const b = normalizeLegacyVideo(input);
    assert.ok(a.ok && b.ok);
    assert.equal(a.video?.id, b.video?.id);
    assert.match(a.video?.id ?? "", /^legacy_fb_[0-9a-f]+$/);
  });
});
