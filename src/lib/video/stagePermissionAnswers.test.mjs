import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readStagePermissionCustomAnswers,
  buildReplaceStagePermissionAnswersPlan,
} from "./stagePermissionAnswers.ts";

function createFakeDb(questions, existingAnswers = []) {
  let selectCount = 0;
  const calls = {
    deleted: 0,
    inserted: null,
  };
  return {
    calls,
    db: {
      select() {
        selectCount += 1;
        return {
          from() {
            return {
              where() {
                return {
                  limit: async () => (selectCount === 1 ? questions : existingAnswers),
                };
              },
            };
          },
        };
      },
      delete() {
        return {
          where: () => {
            calls.deleted += 1;
            return { kind: "delete" };
          },
        };
      },
      insert() {
        return {
          values(values) {
            calls.inserted = values;
            return { kind: "insert" };
          },
        };
      },
    },
  };
}

function createReadFakeDb(questions, answers) {
  let selectCount = 0;
  return {
    select() {
      selectCount += 1;
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => (selectCount === 1 ? questions : answers),
              };
            },
          };
        },
      };
    },
  };
}

test("buildReplaceStagePermissionAnswersPlan plans active stage-permission answers", async () => {
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

  const plan = await buildReplaceStagePermissionAnswersPlan(db, {
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
    actorUserId: "actor-1",
  });

  assert.equal(calls.deleted, 0);
  assert.equal(plan.statements.length, 1);
  assert.deepEqual(plan.expectedChanges, [1]);
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

test("buildReplaceStagePermissionAnswersPlan clears stale answers when submission is empty", async () => {
  const existing = {
    video_id: "video-1",
    event_id: "event-a",
    question_id: "q-stage",
    answer_text: "old",
    answer_json: null,
    created_at: 100,
    updated_at: 100,
  };
  const { db, calls } = createFakeDb([
    {
      id: "q-stage",
      event_id: "event-a",
      question_key: "stage_permission",
      is_active: 1,
    },
  ], [existing]);

  const plan = await buildReplaceStagePermissionAnswersPlan(db, {
    videoId: "video-1",
    eventIds: ["event-a"],
    stagePermission: null,
    now: 123,
    actorUserId: "actor-1",
  });

  assert.equal(calls.deleted, 1);
  assert.equal(calls.inserted, null);
  assert.deepEqual(plan.expectedChanges, [1]);
  assert.deepEqual(plan.audits[0].before, existing);
});

test("readStagePermissionCustomAnswers serializes normalized answers", async () => {
  const db = createReadFakeDb(
    [
      {
        id: "q-stage",
        event_id: "event-a",
        question_key: "stage_permission",
        label: "Stage",
        sort_order: 0,
        is_active: 1,
      },
      {
        id: "q-stage-2",
        event_id: "event-a",
        question_key: "stage_permission_2",
        label: "Stage 2",
        sort_order: 1,
        is_active: 1,
      },
    ],
    [
      { question_id: "q-stage", answer_text: "OK" },
      { question_id: "q-stage-2", answer_text: "条件あり" },
    ],
  );

  const result = await readStagePermissionCustomAnswers(db, {
    videoId: "video-1",
    eventIds: ["event-a"],
  });

  assert.deepEqual(JSON.parse(result), {
    version: 1,
    answers: [
      { id: "stage_permission", label: "Stage", value: "OK" },
      { id: "stage_permission_2", label: "Stage 2", value: "条件あり" },
    ],
  });
});

test("readStagePermissionCustomAnswers returns null when normalized answers are empty", async () => {
  const db = createReadFakeDb(
    [
      {
        id: "q-stage",
        event_id: "event-a",
        question_key: "stage_permission",
        label: "Stage",
        sort_order: 0,
        is_active: 1,
      },
    ],
    [],
  );

  const result = await readStagePermissionCustomAnswers(db, {
    videoId: "video-1",
    eventIds: ["event-a"],
  });

  assert.equal(result, null);
});

test("readStagePermissionCustomAnswers returns null before questions are synced", async () => {
  const db = createReadFakeDb([], []);

  const result = await readStagePermissionCustomAnswers(db, {
    videoId: "video-1",
    eventIds: ["event-a"],
  });

  assert.equal(result, null);
});
