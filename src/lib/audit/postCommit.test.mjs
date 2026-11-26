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

  test("SEC-736/738: hardened YouTube wake logs fixed-only diagnostics and continues post-commit work", async () => {
    const { sendYoutubeSyncPendingWakeBestEffort } = await import(
      "@flamenode/server-core/queues/youtubeSyncWake"
    );
    const { resetQueueWakeWarningStateForTests } = await import(
      "@flamenode/server-core/queues/sendQueueWakeBestEffort"
    );
    const { resetQueueWakeFailureRecordStateForTests } = await import(
      "@flamenode/server-core/queues/wakeFailureRecord"
    );
    resetQueueWakeWarningStateForTests();
    resetQueueWakeFailureRecordStateForTests();
    const secret = "SEC736_PROVIDER_FLAG_GETTER_SECRET";
    const executed = [];
    const sentKinds = new Set();
    const queueHost = {
      readEnv: () => Object.defineProperty({}, "QUEUE_DISPATCH_ENABLED", {
        get() { throw new Error("host getter:" + secret); },
      }),
      readWaitUntil: () => null,
      readKv: () => null,
    };
    const diagnosticLines = [];
    const originalWarn = console.warn;
    let wakeOutcome;
    let warnings;
    try {
      console.warn = (...args) => diagnosticLines.push(args);
      warnings = await runPostCommitBestEffort(
        { flow: "submit_slot_video", traceId: "ft_sec736" },
        [
          {
            name: "youtube_sync_wake",
            run: async () => {
              executed.push("youtube_sync_wake");
              wakeOutcome = await sendYoutubeSyncPendingWakeBestEffort("web", sentKinds, queueHost);
            },
          },
          { name: "revalidate", run: async () => { executed.push("revalidate"); } },
          { name: "icon_orphan_cleanup", run: async () => { executed.push("icon_orphan_cleanup"); } },
        ],
      );
    } finally {
      console.warn = originalWarn;
    }
    // This PR is stacked on the hardened shared Queue helper in #739. Do not
    // permit the old thrown-host fallback or provider-controlled Error.name.
    assert.deepEqual(wakeOutcome, { sent: false, reason: "feature_flags_unavailable" });
    assert.deepEqual(warnings, [], "a fail-closed Queue wake is not a postcommit task exception");
    assert.deepEqual(executed, ["youtube_sync_wake", "revalidate", "icon_orphan_cleanup"]);
    assert.equal(sentKinds.size, 0);
    assert.deepEqual(diagnosticLines.map(([line]) => JSON.parse(line)), [
      { service: "queue-wake", result: "feature_flags_unavailable", kind: "youtube_sync_pending" },
      { service: "queue-wake", result: "last_failure_record_skipped", kind: "youtube_sync_pending", reason: "feature_flags_unavailable" },
    ]);
    assert.ok(!JSON.stringify({ diagnosticLines, wakeOutcome, warnings }).includes(secret),
      "host-provided exceptions must never appear in Queue or postcommit logs");
  });

  test("runPostCommitBestEffort returns empty warnings when all tasks succeed", async () => {
    const warnings = await runPostCommitBestEffort(
      { flow: "test.postCommit", traceId: "ft_test_2" },
      [{ name: "revalidate", run: async () => {} }],
    );
    assert.deepEqual(warnings, []);
  });
}
