import { test } from "node:test";
import assert from "node:assert/strict";
import { syncStagePermissionCustomQuestions } from "./stagePermissionQuestions.ts";

function createFakeDb(existingQuestions) {
  const calls = {
    deleted: [],
    inserted: [],
    updated: [],
  };
  return {
    calls,
    db: {
      select() {
        return {
          from() {
            return {
              where: async () => existingQuestions,
            };
          },
        };
      },
      delete(table) {
        return {
          where: async () => {
            calls.deleted.push(table);
          },
        };
      },
      update(table) {
        return {
          set(values) {
            calls.updated.push({ table, values });
            return {
              where: async () => undefined,
            };
          },
        };
      },
      insert(table) {
        return {
          values(values) {
            calls.inserted.push({ table, values });
            return {
              onConflictDoNothing: async () => undefined,
            };
          },
        };
      },
    },
  };
}

test("syncStagePermissionCustomQuestions preserves existing question ids by key", async () => {
  const { db, calls } = createFakeDb([
    { id: "q-existing", question_key: "stage_permission" },
  ]);

  await syncStagePermissionCustomQuestions(
    db,
    "event-a",
    JSON.stringify({
      stage_permissions: [
        {
          id: "stage_permission",
          enabled: true,
          required: true,
          label: "Updated",
          description: "Desc",
          placeholder: "Placeholder",
        },
      ],
    }),
    123,
  );

  assert.equal(calls.inserted.length, 0);
  assert.equal(calls.deleted.length, 0);
  assert.equal(calls.updated.length, 1);
  assert.deepEqual(calls.updated[0].values, {
    event_id: "event-a",
    question_key: "stage_permission",
    label: "Updated",
    description: "Desc",
    type: "textarea",
    required: 1,
    options_json: null,
    placeholder: "Placeholder",
    max_length: 1000,
    sort_order: 0,
    is_active: 1,
    visibility: "review",
    updated_at: 123,
  });
});

test("syncStagePermissionCustomQuestions removes stale stage questions and answers", async () => {
  const { db, calls } = createFakeDb([
    { id: "q-keep", question_key: "stage_permission" },
    { id: "q-stale", question_key: "stage_permission_2" },
  ]);

  await syncStagePermissionCustomQuestions(
    db,
    "event-a",
    JSON.stringify({
      stage_permissions: [
        {
          id: "stage_permission",
          enabled: true,
          label: "Keep",
        },
      ],
    }),
    123,
  );

  assert.equal(calls.deleted.length, 2);
  assert.equal(calls.updated.length, 1);
  assert.equal(calls.inserted.length, 0);
});
