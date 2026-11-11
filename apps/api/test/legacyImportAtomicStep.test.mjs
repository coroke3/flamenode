import assert from "node:assert/strict";
import { test } from "node:test";
import { commitLegacyImportOneStep } from "../src/routes/admin/legacyImportAtomicStep.ts";

test("RH-002 U02b: one D1 step, then one R2 advance; returns committed progress", async () => {
  const calls = [];
  const outcome = await commitLegacyImportOneStep({
    applyStep: async () => {
      calls.push("D1");
      return { progress: { stage: "events", index: 1 }, complete: false };
    },
    advanceClaim: async (progress) => {
      calls.push("R2:" + progress.index);
      return 1700001000;
    },
    releaseClaim: async () => { calls.push("release"); },
  });
  assert.deepEqual(calls, ["D1", "R2:1"]);
  assert.deepEqual(outcome, {
    kind: "advanced",
    step: { progress: { stage: "events", index: 1 }, complete: false },
    expiresAt: 1700001000,
  });
});

test("RH-002 U02b: R2 CAS failure after D1 commit never repeats D1 and retains next progress", async () => {
  const calls = [];
  const cause = new Error("CAS conflict");
  const outcome = await commitLegacyImportOneStep({
    applyStep: async () => {
      calls.push("D1");
      return { progress: { stage: "videos", index: 2 }, complete: false };
    },
    advanceClaim: async () => { calls.push("R2"); throw cause; },
    releaseClaim: async () => { calls.push("release"); },
  });
  assert.deepEqual(calls, ["D1", "R2", "release"]);
  assert.equal(outcome.kind, "committed_progress_pending");
  assert.equal(outcome.cause, cause);
  assert.deepEqual(outcome.step.progress, { stage: "videos", index: 2 });
});

test("RH-002 U02b: failed release after committed D1 does not erase pending-progress outcome", async () => {
  let writes = 0;
  const outcome = await commitLegacyImportOneStep({
    applyStep: async () => { writes++; return { progress: 4, complete: true }; },
    advanceClaim: async () => { throw new Error("R2 failed"); },
    releaseClaim: async () => { throw new Error("release failed"); },
  });
  assert.equal(writes, 1);
  assert.equal(outcome.kind, "committed_progress_pending");
  assert.equal(outcome.step.progress, 4);
  assert.equal(outcome.step.complete, true);
});

test("RH-002 U02b: D1 failure is not reported as committed; release best effort", async () => {
  const calls = [];
  const dbFailure = new Error("D1 rolled back");
  await assert.rejects(commitLegacyImportOneStep({
    applyStep: async () => { calls.push("D1"); throw dbFailure; },
    advanceClaim: async () => { calls.push("R2"); return 1; },
    releaseClaim: async () => { calls.push("release"); },
  }), (error) => error === dbFailure);
  assert.deepEqual(calls, ["D1", "release"]);

  await assert.rejects(commitLegacyImportOneStep({
    applyStep: async () => { throw dbFailure; },
    advanceClaim: async () => 1,
    releaseClaim: async () => { throw new Error("R2 release unavailable"); },
  }), (error) => error === dbFailure);
});
