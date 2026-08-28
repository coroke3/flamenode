import assert from "node:assert/strict";
import test from "node:test";
import {
  jobFailureWithCounters,
  runJob,
} from "../../workers/shared/runJob.ts";

test("runJobはrethrow:falseでもcron deadlineを握り潰さない", async () => {
  await assert.rejects(
    runJob("worker", "deadline", async () => {
      throw new Error("cron wall-clock deadline exceeded: 1000ms");
    }),
    /cron wall-clock deadline exceeded/,
  );
});

test("runJobはAbortErrorを握り潰さない", async () => {
  await assert.rejects(
    runJob("worker", "abort", async () => {
      throw new DOMException("Aborted", "AbortError");
    }),
    (error) => error?.name === "AbortError",
  );
});

test("runJobはcounter付きfailure内部のcron cancelも再throwする", async () => {
  await assert.rejects(
    runJob("worker", "wrapped-deadline", async () => {
      throw jobFailureWithCounters(
        new Error("cron task aborted: worker"),
        { failed: 1, external_api_calls: 2 },
      );
    }),
    /cron task aborted/,
  );
});

test("runJobはrethrow:falseなら通常の独立job障害を従来通り隔離する", async () => {
  const result = await runJob("worker", "ordinary-failure", async () => {
    throw new Error("ordinary upstream failure");
  });
  assert.equal(result.succeeded, false);
  assert.equal(result.failed, 1);
});
