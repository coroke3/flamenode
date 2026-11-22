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

  test("SEC-736: failed slotted YouTube wake cannot suppress subsequent post-commit work", async () => {
    const executed = [];
    const warnings = await runPostCommitBestEffort(
      { flow: "submit_slot_video", traceId: "ft_sec736" },
      [
        {
          name: "youtube_sync_wake",
          run: async () => {
            executed.push("youtube_sync_wake");
            throw new Error("Queue host unavailable");
          },
        },
        { name: "revalidate", run: async () => { executed.push("revalidate"); } },
        { name: "icon_orphan_cleanup", run: async () => { executed.push("icon_orphan_cleanup"); } },
      ],
    );
    assert.deepEqual(executed, ["youtube_sync_wake", "revalidate", "icon_orphan_cleanup"]);
    assert.deepEqual(warnings.map(({ name, error_code, retryable }) => ({
      name, error_code, retryable,
    })), [{ name: "youtube_sync_wake", error_code: "Error", retryable: false }]);
  });

  test("runPostCommitBestEffort returns empty warnings when all tasks succeed", async () => {
    const warnings = await runPostCommitBestEffort(
      { flow: "test.postCommit", traceId: "ft_test_2" },
      [{ name: "revalidate", run: async () => {} }],
    );
    assert.deepEqual(warnings, []);
  });
}
