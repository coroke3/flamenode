import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLegacyImportPlan } from "./plan.ts";
import { normalizeEventInfo, normalizeLegacyVideo } from "./normalize.ts";
import { stableSha256 } from "./hash.ts";

const NOW = 1700000000;

function makeEvent(id = "ev1", title = "テストイベント") {
  return normalizeEventInfo(
    { eventid: id, eventname: title, start: "2023-01-01", end: "2023-12-31" },
    { importMode: "archive", now: NOW },
  );
}

function makeVideo(eventId = "ev1") {
  return normalizeLegacyVideo({
    eventid: eventId,
    title: "テスト動画",
    tlink: "creator_x",
    ylink: "https://youtu.be/dQw4w9WgXcQ",
    soft: "Blender",
    righttype: "あり",
    toudan: "参加",
  });
}

describe("buildLegacyImportPlan", () => {
  it("assembles a basic plan", () => {
    const normalizedEvents = [makeEvent()];
    const normalizedVideos = [makeVideo()];
    const plan = buildLegacyImportPlan(normalizedEvents, normalizedVideos, NOW);

    assert.equal(plan.events.length, 1);
    assert.equal(plan.videos.length, 1);
    assert.equal(plan.events[0].id, "ev1");

    // events に is_active 等はない
    assert.ok(!("is_active" in plan.events[0]));
    assert.ok(!("is_entry_open" in plan.events[0]));
    assert.ok(!("is_archived" in plan.events[0]));
  });

  it("creates event custom questions for events with linked videos", () => {
    const plan = buildLegacyImportPlan([makeEvent()], [makeVideo()], NOW);
    const qs = plan.eventCustomQuestions.filter((q) => q.event_id === "ev1");
    assert.ok(qs.length >= 2); // stage_permission, stage_participation
    const keys = qs.map((q) => q.question_key);
    assert.ok(keys.includes("stage_permission"));
    assert.ok(keys.includes("stage_participation"));
  });

  it("creates video_custom_answers from legacyCustomAnswers", () => {
    const plan = buildLegacyImportPlan([makeEvent()], [makeVideo()], NOW);
    const ans = plan.videoCustomAnswers;
    assert.ok(ans.length > 0);
    const spAns = ans.find((a) => a.question_key === "stage_permission");
    assert.ok(spAns);
    assert.equal(spAns.answer_text, "あり");
  });

  it("deduplicates x_users", () => {
    const events = [makeEvent("ev1"), makeEvent("ev2")];
    const videos = [makeVideo("ev1"), makeVideo("ev2")]; // both share creator_x
    const plan = buildLegacyImportPlan(events, videos, NOW);
    const xUsers = plan.xUsers.filter((x) => x.id === "creator_x");
    assert.equal(xUsers.length, 1);
  });

  it("sets x_users approval_status to imported", () => {
    const plan = buildLegacyImportPlan([makeEvent()], [makeVideo()], NOW);
    for (const xu of plan.xUsers) {
      assert.equal(xu.approval_status, "imported");
    }
  });

  it("sets event_staff permission_preset to owner for representative", () => {
    const eventResult = normalizeEventInfo({
      eventid: "ev1",
      eventname: "Test",
      member: "主催者",
      memberid: "host_user",
      memberpost: "主催",
    });
    const plan = buildLegacyImportPlan([eventResult], [], NOW);
    const hostStaff = plan.eventStaff.find((s) => s.x_user_id === "host_user");
    assert.ok(hostStaff);
    assert.equal(hostStaff.permission_preset, "owner");
    assert.ok(!("permission_mask" in hostStaff));
  });

  it("collects software labels in videoNormExtras", () => {
    const plan = buildLegacyImportPlan([makeEvent()], [makeVideo()], NOW);
    const extra = plan.videoNormExtras.find((e) => e.video_id.startsWith("legacy_"));
    assert.ok(extra);
    assert.ok(extra.softwareLabels.includes("Blender"));
  });

  it("records parse errors for failed events", () => {
    const badEvent = normalizeEventInfo({ eventid: "" });
    const plan = buildLegacyImportPlan([badEvent], [], NOW);
    assert.equal(plan.errors.filter((e) => e.source === "event").length, 1);
  });

  it("builds identical plans across repeated calls (stable preview token)", async () => {
    const events = [makeEvent()];
    const videos = [makeVideo()];
    const planA = buildLegacyImportPlan(events, videos, NOW);
    const planB = buildLegacyImportPlan(events, videos, NOW);
    assert.deepEqual(planA.eventCustomQuestions, planB.eventCustomQuestions);
    assert.deepEqual(planA.videoCustomAnswers, planB.videoCustomAnswers);
    assert.deepEqual(planA.videos, planB.videos);
    const [hashA, hashB] = await Promise.all([
      stableSha256(planA),
      stableSha256(planB),
    ]);
    assert.equal(hashA, hashB);
  });
});
