import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

const runningWithTsx =
  process.env.FLAMENODE_SLOT_NOTIFICATIONS_EXECUTION === "1";

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
        FLAMENODE_SLOT_NOTIFICATIONS_EXECUTION: "1",
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

  const state = {
    buildOpsThrows: false,
    outboxThrows: false,
    wakeThrows: false,
    statementThrows: false,
  };

  mock.module("@/lib/notifications/opsWebhook", {
    namedExports: {
      async buildOpsChannelWebhookStatement() {
        if (state.buildOpsThrows) {
          throw new Error("ops_build_failed");
        }
        return {
          statement: async () => {
            if (state.statementThrows) {
              throw new Error("ops_statement_failed");
            }
          },
        };
      },
    },
  });

  mock.module("@/lib/notifications/enqueue", {
    namedExports: {
      async buildNotificationOutboxStatement() {
        if (state.outboxThrows) {
          throw new Error("outbox_build_failed");
        }
        return {
          statement: async () => {
            if (state.statementThrows) {
              throw new Error("outbox_statement_failed");
            }
          },
        };
      },
    },
  });

  mock.module("@/lib/notifications/templates/slot", {
    namedExports: {
      buildChannelSlotReservedNotification() {
        return {};
      },
      buildSlotVideoSubmittedNotification() {
        return {};
      },
    },
  });

  mock.module("@/lib/notifications/templates/video", {
    namedExports: {
      buildChannelVideoRegisteredNotification() {
        return {};
      },
    },
  });

  mock.module("@/lib/queues/wakeNotificationQueueAfterCommit", {
    namedExports: {
      async wakeNotificationQueueAfterCommit() {
        if (state.wakeThrows) {
          throw new Error("wake_failed");
        }
      },
    },
  });

  const {
    enqueueSlotReserveOpsWebhookPostCommit,
    enqueueSlotSubmitNotificationsPostCommit,
  } = await import("../actions/slotNotificationsPostCommit.ts");

  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => [{ discord_id: "discord-1" }],
              };
            },
          };
        },
      };
    },
  };

  function reset() {
    state.buildOpsThrows = false;
    state.outboxThrows = false;
    state.wakeThrows = false;
    state.statementThrows = false;
  }

  test("reserve webhook build failure does not throw", async () => {
    reset();
    state.buildOpsThrows = true;
    await assert.doesNotReject(
      enqueueSlotReserveOpsWebhookPostCommit(
        db,
        {
          actorUserId: "user-1",
          eventId: "event-1",
          eventTitle: "Event",
          slotCount: 1,
          displayName: "Name",
          xUserId: null,
          anchorSlotId: "slot-1",
          groupId: null,
        },
        { flow: "slot.reserve", traceId: "trace-1" },
      ),
    );
  });

  test("reserve webhook statement failure does not throw", async () => {
    reset();
    state.statementThrows = true;
    await assert.doesNotReject(
      enqueueSlotReserveOpsWebhookPostCommit(
        db,
        {
          actorUserId: "user-1",
          eventId: "event-1",
          eventTitle: "Event",
          slotCount: 1,
          displayName: "Name",
          xUserId: null,
          anchorSlotId: "slot-1",
          groupId: null,
        },
        { flow: "slot.reserve", traceId: "trace-2" },
      ),
    );
  });

  test("submit notification build failure does not throw", async () => {
    reset();
    state.outboxThrows = true;
    await assert.doesNotReject(
      enqueueSlotSubmitNotificationsPostCommit(
        db,
        {
          userId: "user-1",
          videoId: "video-1",
          videoTitle: "Title",
          slotId: "slot-1",
          eventId: "event-1",
          eventTitle: "Event",
          submittedYoutubeId: "yt-1",
        },
        { flow: "submit_slot_video", traceId: "trace-3" },
      ),
    );
  });

  test("submit notification wake failure does not throw", async () => {
    reset();
    state.wakeThrows = true;
    await assert.doesNotReject(
      enqueueSlotSubmitNotificationsPostCommit(
        db,
        {
          userId: "user-1",
          videoId: "video-1",
          videoTitle: "Title",
          slotId: "slot-1",
          eventId: "event-1",
          eventTitle: "Event",
          submittedYoutubeId: "yt-1",
        },
        { flow: "submit_slot_video", traceId: "trace-4" },
      ),
    );
  });
}
