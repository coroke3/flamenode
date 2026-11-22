import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { runPostCommitBestEffort } = await import("./postCommit.ts");

  test("runPostCommitBestEffort does not throw when a task fails", async () => {
    const warnings = await runPostCommitBestEffort(
      { flow: "test.postCommit", traceId: "ft_test_1" },
      [
        { name: "ok", run: async () => {} },
        {
          name: "fail",
          run: async () => {
            throw new TypeError("network unavailable");
          },
        },
        { name: "after_fail", run: async () => {} },
      ],
    );

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.name, "fail");
    assert.equal(warnings[0]?.error_code, "TypeError");
    assert.equal(warnings[0]?.retryable, true);
  });

  test("SEC-736: an actual YouTube Queue host flags error cannot suppress later post-commit work", async () => {
    const { sendYoutubeSyncPendingWakeBestEffort } = await import(
      "@flamenode/server-core/queues/youtubeSyncWake"
    );
    const executed = [];
    // Queue wake is nominally best-effort, but a provider getter may throw
    // while resolving feature flags. This is a real core call, not a mocked throw.
    const queueHost = {
      readEnv: () => Object.defineProperty({}, "QUEUE_DISPATCH_ENABLED", {
        get() {
          throw new Error("Queue host flag accessor unavailable");
        },
      }),
      readWaitUntil: () => null,
      readKv: () => null,
    };
    // The shared Queue helper is hardened independently in SEC-738. On an
    // old main it throws; after SEC-738 it returns a fail-closed result.
    // The slotted-video post-commit boundary must be safe under either order.
    let wakeOutcome;
    const warnings = await runPostCommitBestEffort(
      { flow: "submit_slot_video", traceId: "ft_sec736" },
      [
        {
          name: "youtube_sync_wake",
          run: async () => {
            executed.push("youtube_sync_wake");
            wakeOutcome = await sendYoutubeSyncPendingWakeBestEffort("web", new Set(), queueHost);
          },
        },
        { name: "revalidate", run: async () => { executed.push("revalidate"); } },
        { name: "icon_orphan_cleanup", run: async () => { executed.push("icon_orphan_cleanup"); } },
      ],
    );
    assert.deepEqual(executed, ["youtube_sync_wake", "revalidate", "icon_orphan_cleanup"]);
    if (wakeOutcome?.sent === false && wakeOutcome.reason === "feature_flags_unavailable") {
      // SEC-738 fail-closed Queue helper must not fabricate a postcommit failure.
      assert.deepEqual(warnings, []);
    } else {
      // Before SEC-738, the real Queue helper can throw on an env getter.
      assert.equal(wakeOutcome, undefined);
      assert.deepEqual(warnings.map(({ name, error_code, retryable }) => ({
        name, error_code, retryable,
      })), [{ name: "youtube_sync_wake", error_code: "Error", retryable: false }]);
    }
  });

  test("runPostCommitBestEffort returns empty warnings when all tasks succeed", async () => {
    const warnings = await runPostCommitBestEffort(
      { flow: "test.postCommit", traceId: "ft_test_2" },
      [{ name: "revalidate", run: async () => {} }],
    );
    assert.deepEqual(warnings, []);
  });
}
