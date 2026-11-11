import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLegacyImportText } from "@flamenode/server-core/legacyImport/parse";
import { normalizeLegacyFiles } from "@flamenode/server-core/legacyImport/normalize";
import { runLegacyImportApplyPipeline } from "../src/routes/admin/legacyImportApplyPipeline.ts";

function harness({ completed = false, stage = "events" } = {}) {
  const calls = [];
  const formData = new FormData();
  formData.set("preview_token", " token ");
  formData.set("plan_hash", " hash ");
  const plan = normalizeLegacyFiles([
    parseLegacyImportText("events.csv", "eventid,eventname\nevent-a,Event A\n"),
  ], { eventVisibility: "private", videoVisibility: "private", now: 1700000000 });
  assert.equal(plan.errors.length, 0);
  const progress = { stage, index: 0 };
  const next = { stage: "events", index: 1 };
  const claim = {
    plan, strategy: "skip_existing", planHash: "hash", attempt: 3,
    completed, progress,
    advance: async (value) => {
      calls.push("R2-advance");
      assert.deepEqual(value, next);
      return 1700000900;
    },
    complete: async () => { calls.push("R2-complete"); return 1700000900; },
    release: async () => { calls.push("R2-release"); },
  };
  const args = {
    formData,
    authUserId: "admin-a",
    claimPreview: async (input) => {
      calls.push("R2-claim");
      assert.deepEqual(input, { authUserId: "admin-a", previewToken: "token", planHash: "hash" });
      return claim;
    },
    applyStep: async (input) => {
      calls.push("D1");
      assert.equal(input.actorAuthUserId, "admin-a");
      assert.equal(input.planHash, "hash");
      assert.equal(input.previewToken, "token");
      assert.equal(input.strategy, "skip_existing");
      assert.deepEqual(input.progress, progress);
      return { progress: next, complete: false };
    },
    resultFromProgress: (_plan, value) => ({ createdEvents: value.index }),
    mapPreviewError: (cause) => {
      calls.push("map-claim-error");
      return { status: 409, body: { ok: false, message: String(cause) } };
    },
    isTransientApplyFailure: (cause) => String(cause).includes("temporary"),
  };
  return { args, calls, claim, plan, progress, next };
}

test("RH-002 U02 apply: one HTTP executes one D1 atomic step then one R2 CAS", async () => {
  const { args, calls } = harness();
  const response = await runLegacyImportApplyPipeline(args);
  assert.deepEqual(calls, ["R2-claim", "D1", "R2-advance"]);
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.mode, "apply");
  assert.equal(response.body.plan_hash, "hash");
  assert.equal(response.body.attempt, 3);
  assert.equal(response.body.continuation_required, true);
  assert.equal(response.body.expires_at, 1700000900);
  assert.equal(response.body.result.createdEvents, 1);
  assert.equal(response.body.result.complete, false);
  assert.equal(response.body.progress.stage, "events");
});

test("RH-002 U02 apply: already-completed preview never executes D1 and completes R2", async () => {
  const { args, calls } = harness({ completed: true });
  const response = await runLegacyImportApplyPipeline(args);
  assert.deepEqual(calls, ["R2-claim", "R2-complete"]);
  assert.equal(response.status, 200);
  assert.equal(response.body.continuation_required, false);
  assert.equal(response.body.result.complete, true);
});

test("RH-002 U02 apply: complete progress stage bypasses D1 even when completion flag is false", async () => {
  const { args, calls } = harness({ stage: "complete" });
  const response = await runLegacyImportApplyPipeline(args);
  assert.deepEqual(calls, ["R2-claim", "R2-complete"]);
  assert.equal(response.status, 200);
});

test("RH-002 U02 apply: missing plan hash refuses R2 claim", async () => {
  const { args, calls } = harness();
  args.formData.delete("plan_hash");
  const response = await runLegacyImportApplyPipeline(args);
  assert.equal(response.status, 409);
  assert.equal(response.body.requires_repreview, true);
  assert.deepEqual(calls, []);
});

test("RH-002 U02 apply: claim errors return mapping without a D1 write", async () => {
  const { args, calls } = harness();
  args.claimPreview = async () => { calls.push("R2-claim"); throw new Error("invalid"); };
  const response = await runLegacyImportApplyPipeline(args);
  assert.deepEqual(calls, ["R2-claim", "map-claim-error"]);
  assert.equal(response.status, 409);
});

test("RH-002 U02 apply: failed D1 step releases claim and cannot advance R2", async () => {
  const { args, calls } = harness();
  args.applyStep = async () => { calls.push("D1"); throw new Error("conflict"); };
  const response = await runLegacyImportApplyPipeline(args);
  assert.deepEqual(calls, ["R2-claim", "D1", "R2-release"]);
  assert.equal(response.status, 409);
  assert.equal(response.body.requires_repreview, true);
  assert.equal(response.body.retryable, false);
  assert.equal(response.body.progress.index, 0);
});

test("RH-002 U02 apply: committed D1 followed by failed R2 CAS is not retried", async () => {
  const { args, calls, claim } = harness();
  claim.advance = async () => { calls.push("R2-advance"); throw new Error("temporary CAS"); };
  const response = await runLegacyImportApplyPipeline(args);
  assert.deepEqual(calls, ["R2-claim", "D1", "R2-advance", "R2-release"]);
  assert.equal(response.status, 503);
  assert.equal(response.body.committed, true);
  assert.equal(response.body.kind, "committed_progress_pending");
  assert.equal(response.body.retryable, true);
  assert.equal(response.body.requires_repreview, false);
  assert.equal(response.body.progress.index, 1);
  assert.equal(response.body.result.complete, false);
});

test("RH-002 U02 apply: nontransient R2 CAS still reports committed with 409", async () => {
  const { args, calls, claim } = harness();
  claim.advance = async () => { calls.push("R2-advance"); throw new Error("conflict"); };
  const response = await runLegacyImportApplyPipeline(args);
  assert.equal(response.status, 409);
  assert.equal(response.body.committed, true);
  assert.deepEqual(calls, ["R2-claim", "D1", "R2-advance", "R2-release"]);
});

test("RH-002 U02 apply: completed claim R2 failure never replays D1", async () => {
  const { args, calls, claim } = harness({ completed: true });
  claim.complete = async () => { calls.push("R2-complete"); throw new Error("temporary outage"); };
  const response = await runLegacyImportApplyPipeline(args);
  assert.deepEqual(calls, ["R2-claim", "R2-complete", "R2-release"]);
  assert.equal(response.status, 503);
  assert.equal(response.body.requires_repreview, false);
});

test("RH-002 U02 apply: release failure cannot mask atomic D1 failure", async () => {
  const { args, calls, claim } = harness();
  args.applyStep = async () => { calls.push("D1"); throw new Error("conflict"); };
  claim.release = async () => { calls.push("R2-release"); throw new Error("temporary release"); };
  const response = await runLegacyImportApplyPipeline(args);
  assert.deepEqual(calls, ["R2-claim", "D1", "R2-release"]);
  assert.equal(response.status, 409);
});

test("RH-002 U02 apply: a claimed oversized event step rejects before D1 and releases R2", async () => {
  const { args, calls, plan } = harness();
  plan.events[0].title = "あ".repeat(50_000);
  const response = await runLegacyImportApplyPipeline(args);
  assert.deepEqual(calls, ["R2-claim", "R2-release"]);
  assert.equal(response.status, 409);
  assert.equal(response.body.requires_repreview, true);
  assert.ok(Array.isArray(response.body.errors));
  assert.ok(response.body.errors.length > 0);
});
