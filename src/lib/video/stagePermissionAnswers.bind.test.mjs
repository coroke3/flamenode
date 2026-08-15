import assert from "node:assert/strict";
import { test } from "node:test";
import { readStagePermissionCustomAnswers } from "./stagePermissionAnswers.ts";

test("readStagePermissionCustomAnswers chunks oversized event scopes", async () => {
  const eventIds = Array.from({ length: 120 }, (_, index) => `event-${index}`);
  const questions = [
    {
      id: "q-stage",
      event_id: "event-0",
      question_key: "stage_permission",
      label: "Stage",
      sort_order: 0,
      is_active: 1,
    },
  ];
  const answers = [{ question_id: "q-stage", answer_text: "OK" }];
  let selectCount = 0;
  const db = {
    select() {
      selectCount += 1;
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => {
                  if (selectCount === 1) return questions;
                  if (selectCount === 2) return [];
                  return answers;
                },
              };
            },
          };
        },
      };
    },
  };

  const result = await readStagePermissionCustomAnswers(db, {
    videoId: "video-1",
    eventIds,
  });

  assert.equal(selectCount, 3);
  assert.deepEqual(JSON.parse(result), {
    version: 1,
    answers: [{ id: "stage_permission", label: "Stage", value: "OK" }],
  });
});
