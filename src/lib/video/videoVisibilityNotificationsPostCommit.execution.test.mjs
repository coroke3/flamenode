import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx =
  process.env.FLAMENODE_VISIBILITY_NOTIFICATIONS_EXECUTION === "1";

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
        FLAMENODE_VISIBILITY_NOTIFICATIONS_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  mock.module("next/navigation", {
    namedExports: {
      unstable_rethrow() {},
    },
  });

  const state = { statementThrows: false, wakeThrows: false, wakeCalls: 0 };

  mock.module("@/lib/queues/wakeNotificationQueueAfterCommit", {
    namedExports: {
      async wakeNotificationQueueAfterCommit() {
        state.wakeCalls += 1;
        if (state.wakeThrows) {
          throw new Error("wake_failed");
        }
      },
    },
  });

  const { enqueueVideoVisibilityNotificationsPostCommit } = await import(
    "./videoVisibilityTransition.ts"
  );

  const db = {};

  test("visibility notification statement failure does not throw", async () => {
    state.statementThrows = true;
    state.wakeCalls = 0;
    await assert.doesNotReject(
      enqueueVideoVisibilityNotificationsPostCommit(
        db,
        {
          statements: [
            async () => {
              if (state.statementThrows) {
                throw new Error("notification_statement_failed");
              }
            },
          ],
        },
        { flow: "manage_video_status", traceId: "trace-1", wakeSource: "manage" },
      ),
    );
  });

  test("visibility notification wake failure does not throw", async () => {
    state.statementThrows = false;
    state.wakeThrows = true;
    state.wakeCalls = 0;
    await assert.doesNotReject(
      enqueueVideoVisibilityNotificationsPostCommit(
        db,
        {
          statements: [async () => {}],
        },
        { flow: "manage_video_status", traceId: "trace-2", wakeSource: "manage" },
      ),
    );
    assert.equal(state.wakeCalls, 1);
  });
}
