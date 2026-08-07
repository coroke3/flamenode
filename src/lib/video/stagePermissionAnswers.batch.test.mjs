import { test } from "node:test";
import assert from "node:assert/strict";

import { batchReadStagePermissionCustomAnswers } from "./stagePermissionAnswers.ts";

function createBatchDb(questions, answers) {
  let selectCount = 0;
  return {
    selectCount: () => selectCount,
    db: {
      select() {
        selectCount += 1;
        return {
          from() {
            return {
              where() {
                return {
                  limit: async () => undefined,
                  then: undefined,
                  [Symbol.asyncIterator]: undefined,
                };
              },
            };
          },
        };
      },
    },
    questions,
    answers,
  };
}

test("batchReadStagePermissionCustomAnswers issues at most two reads", async () => {
  const questions = [
    {
      id: "q-stage",
      event_id: "event-a",
      question_key: "stage_permission",
      label: "Stage",
      sort_order: 0,
      is_active: 1,
    },
  ];
  const answers = [
    {
      video_id: "video-1",
      question_id: "q-stage",
      answer_text: "OK",
    },
    {
      video_id: "video-2",
      question_id: "q-stage",
      answer_text: "条件あり",
    },
  ];

  let selectCount = 0;
  const db = {
    select() {
      selectCount += 1;
      return {
        from() {
          return {
            where() {
              if (selectCount === 1) {
                return Promise.resolve(questions);
              }
              return Promise.resolve(answers);
            },
          };
        },
      };
    },
  };

  const result = await batchReadStagePermissionCustomAnswers(db, [
    { videoId: "video-1", eventIds: ["event-a"] },
    { videoId: "video-2", eventIds: ["event-a"] },
    { videoId: "video-3", eventIds: ["event-a"] },
  ]);

  assert.equal(selectCount, 2);
  assert.deepEqual(JSON.parse(result.get("video-1")), {
    version: 1,
    answers: [{ id: "stage_permission", label: "Stage", value: "OK" }],
  });
  assert.deepEqual(JSON.parse(result.get("video-2")), {
    version: 1,
    answers: [{ id: "stage_permission", label: "Stage", value: "条件あり" }],
  });
  assert.equal(result.get("video-3"), null);
});

test("batchReadStagePermissionCustomAnswers returns null when no event ids", async () => {
  const db = {
    select() {
      throw new Error("should not query");
    },
  };
  const result = await batchReadStagePermissionCustomAnswers(db, [
    { videoId: "video-1", eventIds: [] },
  ]);
  assert.equal(result.get("video-1"), null);
});
