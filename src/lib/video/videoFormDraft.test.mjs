import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVideoFormDraft,
  parseVideoFormDraft,
  videoFormDraftAnswersToRecord,
  videoFormDraftIsStale,
} from "./videoFormDraft.ts";

test("video draft keeps only whitelisted fields and serializes arbitrary question keys", () => {
  const formData = new FormData();
  formData.set("title", "作品");
  formData.set("youtube_url", "dQw4w9WgXcQ");
  formData.set("active_x_snapshot", "must-not-be-restored");
  formData.set("video_id", "server-value");
  const draft = buildVideoFormDraft({
    formData,
    customAnswers: { token: ["回答"] },
    stageAnswers: { "stage-1": "回答" },
    members: [],
    selectedEventIds: ["event-1"],
    selectedPart: "昼",
    isCollab: false,
    currentStep: 2,
    maxReachedStep: 3,
    baselineUpdatedAt: 10,
  });

  assert.equal(draft.fields.title, "作品");
  assert.equal("active_x_snapshot" in draft.fields, false);
  assert.equal("video_id" in draft.fields, false);
  assert.deepEqual(videoFormDraftAnswersToRecord(draft.customAnswers), {
    token: ["回答"],
  });
  assert.equal(draft.metadata.baselineUpdatedAt, 10);
});

test("video draft parses typed and legacy values and detects stale edit baselines", () => {
  const typed = parseVideoFormDraft({
    schemaVersion: "video-form-v1",
    fields: { title: "typed" },
    customAnswers: [{ key: "token", value: "safe" }],
    stageAnswers: [{ id: "q1", value: "yes" }],
    members: [],
    selectedEventIds: ["event-1"],
    selectedPart: "",
    isCollab: false,
    currentStep: 1,
    maxReachedStep: 1,
    metadata: { baselineUpdatedAt: 5 },
  });
  assert.ok(typed);
  assert.equal(videoFormDraftIsStale(typed, 6), true);
  assert.equal(videoFormDraftIsStale(typed, 5), false);

  const legacy = parseVideoFormDraft({
    title: "legacy",
    "custom_answer:event:token": "answer",
    members_json: "[]",
    event_ids: "event-1",
  });
  assert.ok(legacy);
  assert.equal(legacy.fields.title, "legacy");
  assert.deepEqual(videoFormDraftAnswersToRecord(legacy.customAnswers), {
    "event:token": "answer",
  });
  assert.deepEqual(legacy.selectedEventIds, ["event-1"]);
});
