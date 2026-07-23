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

  test("runPostCommitBestEffort returns empty warnings when all tasks succeed", async () => {
    const warnings = await runPostCommitBestEffort(
      { flow: "test.postCommit", traceId: "ft_test_2" },
      [{ name: "revalidate", run: async () => {} }],
    );
    assert.deepEqual(warnings, []);
  });
}
