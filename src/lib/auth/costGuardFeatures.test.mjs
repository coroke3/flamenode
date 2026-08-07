import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  evaluateCostGuardCore,
  parseWriteFeatureList,
} from "./writeGuardCore.ts";

const source = await readFile(new URL("./writeGuard.ts", import.meta.url), "utf8");

test("CostGuard feature list accepts an empty or valid string array", () => {
  assert.deepEqual(parseWriteFeatureList(null), { ok: true, features: [] });
  assert.deepEqual(parseWriteFeatureList(""), { ok: true, features: [] });
  assert.deepEqual(parseWriteFeatureList('["edit_video"]'), {
    ok: true,
    features: ["edit_video"],
  });
});

test("CostGuard feature list is fail-closed when malformed", () => {
  assert.deepEqual(parseWriteFeatureList("{invalid"), { ok: false });
  assert.deepEqual(parseWriteFeatureList('{"key":"value"}'), { ok: false });
  assert.deepEqual(parseWriteFeatureList("[123]"), { ok: false });
  assert.deepEqual(
    parseWriteFeatureList(JSON.stringify(Array.from({ length: 101 }, () => "edit_video"))),
    { ok: false },
  );
});

test("missing system settings and invalid mode are fail-closed", () => {
  assert.match(source, /if \(!row\) return \{ blocked: true, reason: "mode" \}/);
  assert.deepEqual(evaluateCostGuardCore({
    feature: "edit_video",
    operationMode: "invalid",
    disabledFeaturesJson: null,
    exceptionUntil: null,
    exceptionFeaturesJson: null,
    now: 100,
  }), { blocked: true, reason: "mode" });
});

test("active override allows only its explicit known feature", () => {
  const base = {
    operationMode: "maintenance",
    disabledFeaturesJson: null,
    exceptionUntil: 200,
    exceptionFeaturesJson: '["edit_video"]',
    now: 100,
  };
  assert.deepEqual(evaluateCostGuardCore({ ...base, feature: "edit_video" }), { blocked: false });
  assert.deepEqual(evaluateCostGuardCore({ ...base, feature: "post_video_unslotted" }), { blocked: true, reason: "mode" });
});

test("expired, malformed, and unknown overrides never bypass", () => {
  const base = {
    feature: "edit_video",
    operationMode: "maintenance",
    disabledFeaturesJson: null,
    now: 100,
  };
  assert.deepEqual(evaluateCostGuardCore({ ...base, exceptionUntil: 100, exceptionFeaturesJson: '["edit_video"]' }), { blocked: true, reason: "mode" });
  assert.deepEqual(evaluateCostGuardCore({ ...base, exceptionUntil: 200, exceptionFeaturesJson: "not-json" }), { blocked: true, reason: "feature" });
  assert.deepEqual(evaluateCostGuardCore({ ...base, exceptionUntil: 200, exceptionFeaturesJson: '["unknown"]' }), { blocked: true, reason: "feature" });
});

test("normal mode with no disabled features allows writes without budget input", () => {
  const base = {
    operationMode: "normal",
    disabledFeaturesJson: null,
    exceptionUntil: null,
    exceptionFeaturesJson: null,
    now: 100,
  };
  assert.deepEqual(
    evaluateCostGuardCore({ ...base, feature: "edit_video" }),
    { blocked: false },
  );
  assert.deepEqual(
    evaluateCostGuardCore({ ...base, feature: "post_video_unslotted" }),
    { blocked: false },
  );
});

test("economy mode does not block writes when feature is not disabled", () => {
  const base = {
    operationMode: "economy",
    disabledFeaturesJson: null,
    exceptionUntil: null,
    exceptionFeaturesJson: null,
    now: 100,
  };
  assert.deepEqual(
    evaluateCostGuardCore({ ...base, feature: "edit_video" }),
    { blocked: false },
  );
  assert.deepEqual(
    evaluateCostGuardCore({
      ...base,
      disabledFeaturesJson: '["post_video_unslotted"]',
      feature: "edit_video",
    }),
    { blocked: false },
  );
  assert.deepEqual(
    evaluateCostGuardCore({
      ...base,
      disabledFeaturesJson: '["edit_video"]',
      feature: "edit_video",
    }),
    { blocked: true, reason: "feature" },
  );
});

test("evaluateCostGuardCore inputs are mode, disabled features, and optional override only", async () => {
  const coreSource = await readFile(new URL("./writeGuardCore.ts", import.meta.url), "utf8");
  assert.match(coreSource, /operationMode:/);
  assert.match(coreSource, /disabledFeaturesJson:/);
  assert.doesNotMatch(coreSource, /d1Budget/);
  assert.doesNotMatch(coreSource, /quotaBudget/);
  assert.doesNotMatch(coreSource, /ExternalRequestBudget/);
  assert.doesNotMatch(coreSource, /cost_usage_snapshot/);
});
