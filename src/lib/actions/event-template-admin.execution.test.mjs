import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx =
  process.env.FLAMENODE_EVENT_TEMPLATE_ADMIN_EXECUTION === "1";

if (!runningWithTsx) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--test",
      fileURLToPath(import.meta.url),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_EVENT_TEMPLATE_ADMIN_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  let currentHarness;

  class NextControlFlowError extends Error {}

  mock.module("next/cache", {
    namedExports: {
      revalidatePath(path) {
        currentHarness.revalidatedPaths.push(path);
        if (currentHarness.revalidationError) {
          throw currentHarness.revalidationError;
        }
      },
    },
  });
  mock.module("next/navigation", {
    namedExports: {
      unstable_rethrow(error) {
        if (error instanceof NextControlFlowError) throw error;
      },
    },
  });
  mock.module("@/lib/auth/writeGuard", {
    namedExports: {
      async requireAdminWrite() {
        return {
          ok: true,
          user: { id: "admin-1", role: "admin" },
          db: currentHarness.db,
        };
      },
    },
  });
  mock.module("@/lib/audit/mutate", {
    namedExports: {
      async mutateWithAudit(_db, input) {
        currentHarness.mutations.push(input);
        if (currentHarness.mutationError) {
          throw currentHarness.mutationError;
        }
      },
    },
  });
  mock.module("@/lib/admin/eventTemplateSettings", {
    namedExports: {
      snapshotFromEvent(event, customQuestions, stagePermissionSettingsJson) {
        return {
          event_id: event.id,
          custom_questions: customQuestions,
          stage_permission_settings_json: stagePermissionSettingsJson,
        };
      },
    },
  });
  mock.module("@/lib/video/stagePermissionQuestions", {
    namedExports: {
      async loadStagePermissionFormSettingsJson() {
        return "{}";
      },
    },
  });
  mock.module("@/lib/utils/id", {
    namedExports: {
      generateId() {
        return "etmpl-fixed";
      },
    },
  });
  mock.module("@/lib/observability/flowTrace", {
    namedExports: {
      createTraceId() {
        return "trace-fixed";
      },
      logFlowTrace() {},
    },
  });

  const { deleteEventTemplate, saveEventAsTemplate } = await import(
    "./event-template-admin.ts"
  );

  function createHarness(selectResults) {
    const state = {
      selectResults: [...selectResults],
      mutations: [],
      mutationError: null,
      revalidationError: null,
      revalidatedPaths: [],
      db: null,
    };

    function takeSelectResult() {
      const result = state.selectResults.shift() ?? [];
      if (result instanceof Error) throw result;
      return result;
    }

    state.db = {
      select() {
        const result = takeSelectResult();
        return {
          from() {
            return {
              where() {
                return {
                  async limit() {
                    return result;
                  },
                  async orderBy() {
                    return result;
                  },
                };
              },
              async orderBy() {
                return result;
              },
            };
          },
        };
      },
      insert() {
        return {
          values(values) {
            return { kind: "insert", values };
          },
        };
      },
      delete() {
        return {
          where() {
            return { kind: "delete" };
          },
        };
      },
    };
    return state;
  }

  function saveFormData() {
    const formData = new FormData();
    formData.set("event_id", "event-1");
    formData.set("name", "template-1");
    return formData;
  }

  function deleteFormData() {
    const formData = new FormData();
    formData.set("template_id", "template-1");
    return formData;
  }

  test("save returns a safe failure result when the event lookup fails", async (t) => {
    const harness = createHarness([new Error("D1 lookup failed")]);
    currentHarness = harness;
    t.mock.method(console, "error", () => {});

    const result = await saveEventAsTemplate(saveFormData());

    assert.equal(result.ok, false);
    assert.equal(harness.mutations.length, 0);
    assert.deepEqual(harness.revalidatedPaths, []);
  });

  test("save remains successful when every post-commit revalidation fails", async (t) => {
    const harness = createHarness([
      [{ id: "event-1" }],
      [{ question_key: "question-1", label: "Question" }],
    ]);
    harness.revalidationError = new TypeError("cache unavailable");
    currentHarness = harness;
    t.mock.method(console, "warn", () => {});

    const result = await saveEventAsTemplate(saveFormData());

    assert.equal(result.ok, true);
    assert.equal(harness.mutations.length, 1);
    assert.deepEqual(harness.revalidatedPaths, [
      "/admin/events/templates",
      "/admin/events/event-1",
      "/manage/events/event-1",
    ]);
  });

  test("delete returns a safe failure result when the atomic mutation fails", async (t) => {
    const harness = createHarness([
      [
        {
          id: "template-1",
          name: "template-1",
          description: null,
          source_event_id: "event-1",
          settings_json: "{}",
          created_by_user_id: "admin-1",
          created_at: 1,
          updated_at: 1,
        },
      ],
    ]);
    harness.mutationError = new Error("D1 batch failed");
    currentHarness = harness;
    t.mock.method(console, "error", () => {});

    const result = await deleteEventTemplate(deleteFormData());

    assert.equal(result.ok, false);
    assert.equal(harness.mutations.length, 1);
    assert.deepEqual(harness.revalidatedPaths, []);
  });

  test("delete remains successful when every post-commit revalidation fails", async (t) => {
    const harness = createHarness([
      [
        {
          id: "template-1",
          name: "template-1",
          description: null,
          source_event_id: "event-1",
          settings_json: "{}",
          created_by_user_id: "admin-1",
          created_at: 1,
          updated_at: 1,
        },
      ],
    ]);
    harness.revalidationError = new TypeError("cache unavailable");
    currentHarness = harness;
    t.mock.method(console, "warn", () => {});

    const result = await deleteEventTemplate(deleteFormData());

    assert.equal(result.ok, true);
    assert.equal(harness.mutations.length, 1);
    assert.deepEqual(harness.revalidatedPaths, [
      "/admin/events/templates",
      "/admin/events/new",
    ]);
  });

  test("Next.js control-flow errors are rethrown from mutation failures", async () => {
    const harness = createHarness([
      [
        {
          id: "template-1",
          name: "template-1",
          description: null,
          source_event_id: "event-1",
          settings_json: "{}",
          created_by_user_id: "admin-1",
          created_at: 1,
          updated_at: 1,
        },
      ],
    ]);
    const controlFlowError = new NextControlFlowError("NEXT_REDIRECT");
    harness.mutationError = controlFlowError;
    currentHarness = harness;

    await assert.rejects(
      deleteEventTemplate(deleteFormData()),
      (error) => error === controlFlowError,
    );
  });
}
