import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WRITE_FEATURE_KEYS,
  isWriteFeatureKey,
  evaluateCostGuardCore,
  parseWriteFeatureList,
  evaluateWriteIdentity,
  evaluateActiveXWriteAccess,
} from "../src/admin/index.ts";

describe("admin/costGuard", () => {
  it("recognizes write feature keys", () => {
    assert.equal(isWriteFeatureKey("post_video_unslotted"), true);
    assert.equal(isWriteFeatureKey("manage_slot_create"), true);
    assert.equal(isWriteFeatureKey("unknown_feature"), false);
  });

  it("parses valid write feature lists fail-closed", () => {
    assert.deepEqual(parseWriteFeatureList(null), { ok: true, features: [] });
    assert.deepEqual(parseWriteFeatureList('["post_video_unslotted"]'), {
      ok: true,
      features: ["post_video_unslotted"],
    });
    assert.deepEqual(parseWriteFeatureList("invalid json"), { ok: false });
  });

  it("evaluates cost guard core correctly", () => {
    const normal = evaluateCostGuardCore({
      feature: "post_video_unslotted",
      operationMode: "normal",
      disabledFeaturesJson: "[]",
      exceptionUntil: null,
      exceptionFeaturesJson: "[]",
      now: 1000,
    });
    assert.deepEqual(normal, { blocked: false });

    const disabled = evaluateCostGuardCore({
      feature: "post_video_unslotted",
      operationMode: "normal",
      disabledFeaturesJson: '["post_video_unslotted"]',
      exceptionUntil: null,
      exceptionFeaturesJson: "[]",
      now: 1000,
    });
    assert.deepEqual(disabled, { blocked: true, reason: "feature" });

    const emergency = evaluateCostGuardCore({
      feature: "post_video_unslotted",
      operationMode: "emergency_read_only",
      disabledFeaturesJson: "[]",
      exceptionUntil: null,
      exceptionFeaturesJson: "[]",
      now: 1000,
    });
    assert.deepEqual(emergency, { blocked: true, reason: "mode" });
  });
});

describe("admin/writeIdentity", () => {
  it("rejects banned users and unaccepted terms", () => {
    assert.equal(
      evaluateWriteIdentity({ role: "user", is_banned: 1, is_tos_accepted: 1, terms_reaccept_required: 0 }),
      "banned",
    );
    assert.equal(
      evaluateWriteIdentity({ role: "user", is_banned: 0, is_tos_accepted: 0, terms_reaccept_required: 0 }),
      "tos_required",
    );
    assert.equal(
      evaluateWriteIdentity({ role: "user", is_banned: 0, is_tos_accepted: 1, terms_reaccept_required: 1 }),
      "tos_reaccept_required",
    );
    assert.equal(
      evaluateWriteIdentity({ role: "user", is_banned: 0, is_tos_accepted: 1, terms_reaccept_required: 0 }, "admin"),
      "forbidden",
    );
    assert.equal(
      evaluateWriteIdentity({ role: "admin", is_banned: 0, is_tos_accepted: 1, terms_reaccept_required: 0 }, "admin"),
      null,
    );
  });

  it("evaluates active X write access", () => {
    assert.equal(
      evaluateActiveXWriteAccess({
        requireActiveXId: true,
        requireApprovedActiveXId: false,
        activeXId: null,
        approvalStatus: null,
        approvedXIds: [],
      }),
      "active_x_required",
    );
    assert.equal(
      evaluateActiveXWriteAccess({
        requireActiveXId: true,
        requireApprovedActiveXId: false,
        activeXId: "handle",
        approvalStatus: "rejected",
        approvedXIds: [],
      }),
      "active_x_rejected",
    );
    assert.equal(
      evaluateActiveXWriteAccess({
        requireActiveXId: true,
        requireApprovedActiveXId: true,
        activeXId: "handle",
        approvalStatus: "pending",
        approvedXIds: [],
      }),
      "active_x_not_approved",
    );
    assert.equal(
      evaluateActiveXWriteAccess({
        requireActiveXId: true,
        requireApprovedActiveXId: true,
        activeXId: "handle",
        approvalStatus: "approved",
        approvedXIds: ["handle"],
      }),
      null,
    );
  });
});
