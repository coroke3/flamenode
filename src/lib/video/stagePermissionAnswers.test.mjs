import { test } from "node:test";
import assert from "node:assert/strict";
import { replaceStagePermissionCustomAnswers } from "./stagePermissionAnswers.ts";

function createFakeDb(questions) {
  const calls = {
    deleted: 0,
    inserted: null,
  };
  return {
    calls,
    db: {
      select() {
        return {
          from() {
            return {
              where: async () => questions,
            };
          },
        };
      },
      delete() {
        return {
          where: async () => {
            calls.deleted += 1;
          },
        };
      },
      insert() {
        return {
          values(values) {
            calls.inserted = values;
            return {
              onConflictDoNothing: async () => undefined,
            };
          },
        };
      },
    },
  };
}

test("replaceStagePermissionCustomAnswers replaces active stage-permission answers", async () => {
  const { db, calls } = createFakeDb([
    {
      id: "q-stage",
      event_id: "event-a",
      question_key: "stage_permission",
      is_active: 1,
    },
    {
      id: "q-stage-2",
      event_id: "event-a",
      question_key: "stage_permission_2",
      is_active: 0,
    },
  ]);

  await replaceStagePermissionCustomAnswers(db, {
    videoId: "video-1",
    eventIds: ["event-a"],
    deleteEventIds: ["event-old"],
    stagePermission: JSON.stringify({
      version: 1,
      answers: [
        { id: "stage_permission", label: "Stage", value: "OK" },
        { id: "stage_permission_2", label: "Stage 2", value: "Inactive" },
      ],
    }),
    now: 123,
  });

  assert.equal(calls.deleted, 1);
  assert.deepEqual(calls.inserted, [
    {
      video_id: "video-1",
      event_id: "event-a",
      question_id: "q-stage",
      answer_text: "OK",
      answer_json: null,
      created_at: 123,
      updated_at: 123,
    },
  ]);
});

test("replaceStagePermissionCustomAnswers clears stale answers when submission is empty", async () => {
  const { db, calls } = createFakeDb([
    {
      id: "q-stage",
      event_id: "event-a",
      question_key: "stage_permission",
      is_active: 1,
    },
  ]);

  await replaceStagePermissionCustomAnswers(db, {
    videoId: "video-1",
    eventIds: ["event-a"],
    stagePermission: null,
    now: 123,
  });

  assert.equal(calls.deleted, 1);
  assert.equal(calls.inserted, null);
});
