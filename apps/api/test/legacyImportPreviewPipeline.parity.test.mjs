import assert from "node:assert/strict";
import { test } from "node:test";
import { preflightLegacyImportPlan } from "@flamenode/server-core/legacyImport/preflight";
import { runLegacyImportPreviewPipeline } from "../src/routes/admin/legacyImportPreviewPipeline.ts";

function fixture(csv = "eventid,eventname\nevent-a,Event A\n") {
  const actions = [];
  const formData = new FormData();
  formData.set("strategy", "skip_existing");
  const args = {
    authUserId: "admin-a",
    formData,
    files: [{
      name: "events.csv",
      size: 80,
      text: async () => { actions.push("read"); return csv; },
    }],
    now: 1700000000,
    estimateStoredBytes: () => { actions.push("estimate"); return 2000; },
    preflight: async (plan) => {
      actions.push("preflight");
      assert.equal(plan.events[0]?.id, "event-a");
      return { existingEventIds: ["event-a"], existingVideoIds: ["video-a"] };
    },
    createPreview: async (input) => {
      actions.push("R2");
      assert.equal(input.authUserId, "admin-a");
      assert.deepEqual(input.skipExistingEventIds, ["event-a"]);
      assert.deepEqual(input.skipExistingVideoIds, ["video-a"]);
      return { previewToken: "token", planHash: "hash", expiresAt: 1700000900 };
    },
    mapStoreError: () => { actions.push("error-map"); return {
      status: 503, body: { ok: false, message: "unavailable" },
    }; },
  };
  return { args, actions };
}

test("RH-002 U02 pipeline: CSV -> normalization -> size -> D1 preflight -> R2 credential", async () => {
  const { args, actions } = fixture();
  const result = await runLegacyImportPreviewPipeline(args);
  assert.equal(result.status, 200);
  assert.deepEqual(actions, ["read", "estimate", "preflight", "R2"]);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.summary.events, 1);
  assert.equal(result.body.summary.inputRows, 1);
  assert.equal(result.body.preview.events[0].id, "event-a");
  assert.equal(result.body.preview_token, "token");
  assert.equal(result.body.plan_hash, "hash");
});

test("RH-002 U02 pipeline: bad row does not invoke estimator, D1 or R2", async () => {
  const { args, actions } = fixture("id,title\nmissing-eventid,Incomplete\n");
  const result = await runLegacyImportPreviewPipeline(args);
  assert.equal(result.status, 422);
  assert.equal(result.body.ok, false);
  assert.ok(result.body.errors.some((error) => error.includes("eventid")));
  assert.deepEqual(actions, ["read"]);
});

test("RH-002 U02 pipeline: malformed decision JSON blocks D1 and R2", async () => {
  const { args, actions } = fixture();
  args.formData.set("video_custom_field_decisions", "{");
  const result = await runLegacyImportPreviewPipeline(args);
  assert.equal(result.status, 400);
  assert.match(result.body.message, /JSON/);
  assert.deepEqual(actions, ["read"]);
});

test("RH-002 U02 pipeline: file size guard blocks body read before authorization-bound storage", async () => {
  const { args, actions } = fixture();
  args.files[0].size = 2 * 1024 * 1024 + 1;
  const result = await runLegacyImportPreviewPipeline(args);
  assert.equal(result.status, 400);
  assert.match(result.body.message, /2MB/);
  assert.deepEqual(actions, []);
});

test("RH-002 U02 pipeline: 512KiB stored plan guard prevents D1 and R2", async () => {
  const { args, actions } = fixture();
  args.estimateStoredBytes = () => {
    actions.push("estimate");
    return 512 * 1024 + 1;
  };
  const result = await runLegacyImportPreviewPipeline(args);
  assert.equal(result.status, 413);
  assert.match(result.body.message, /512KB/);
  assert.deepEqual(actions, ["read", "estimate"]);
});

test("RH-002 U02 pipeline: genuine D1 domain conflict preserves feedback without R2 save", async () => {
  const { args, actions } = fixture();
  args.formData.set("strategy", "create_only");
  args.preflight = async (plan, strategy) => {
    actions.push("preflight");
    const db = { select: () => ({ from: () => ({ where: async () => [{ id: "event-a" }] }) }) };
    return preflightLegacyImportPlan(db, plan, strategy);
  };
  const result = await runLegacyImportPreviewPipeline(args);
  assert.equal(result.status, 409);
  assert.match(result.body.message, /イベント event-a は既に存在します/);
  assert.equal(result.body.preview_token, undefined);
  assert.deepEqual(actions, ["read", "estimate", "preflight"]);
});

test("RH-002 U02 pipeline: D1 provider failures return fixed 409 without reading error properties", async () => {
  let inspected = 0;
  const hostile = new Error();
  Object.defineProperty(hostile, "message", {
    get() { inspected++; throw new Error("PRIVATE_MESSAGE_GETTER"); },
  });
  const proxy = new Proxy({}, {
    get() { inspected++; throw new Error("PRIVATE_PROXY"); },
    getPrototypeOf() { inspected++; throw new Error("PRIVATE_PROTOTYPE"); },
  });
  for (const cause of [
    new Error("Failed query: SELECT secret FROM internal_table; params: PRIVATE_VALUE"),
    hostile, proxy,
  ]) {
    const { args, actions } = fixture();
    args.preflight = async () => { actions.push("preflight"); throw cause; };
    const result = await runLegacyImportPreviewPipeline(args);
    assert.equal(result.status, 409);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.message, "現在のDB状態へ適用できないplanです。");
    assert.equal(result.body.requires_repreview, false);
    assert.equal(result.body.preview_token, undefined);
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_|SELECT secret|internal_table/);
    assert.deepEqual(actions, ["read", "estimate", "preflight"]);
  }
  assert.equal(inspected, 0);
});

test("RH-002 U02 pipeline: R2 failure is fail-closed and does not return preview credentials", async () => {
  const { args, actions } = fixture();
  args.createPreview = async () => {
    actions.push("R2");
    throw new Error("bucket unavailable");
  };
  const result = await runLegacyImportPreviewPipeline(args);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, message: "unavailable" });
  assert.deepEqual(actions, ["read", "estimate", "preflight", "R2", "error-map"]);
});
