import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateActiveXWriteAccess,
  evaluateWriteIdentity,
  isWriteFeatureKey,
} from "./writeGuardCore.ts";

const validAdmin = {
  role: "admin",
  is_banned: 0,
  is_tos_accepted: 1,
  terms_reaccept_required: 0,
};

test("admin write identity never bypasses BAN or terms checks", () => {
  assert.equal(evaluateWriteIdentity({ ...validAdmin, is_banned: 1 }, "admin"), "banned");
  assert.equal(evaluateWriteIdentity({ ...validAdmin, is_tos_accepted: 0 }, "admin"), "tos_required");
  assert.equal(evaluateWriteIdentity({ ...validAdmin, terms_reaccept_required: 1 }, "admin"), "tos_reaccept_required");
});

test("admin write rejects non-admin and accepts a valid admin", () => {
  assert.equal(evaluateWriteIdentity({ ...validAdmin, role: "moderator" }, "admin"), "forbidden");
  assert.equal(evaluateWriteIdentity(validAdmin, "admin"), null);
});

test("approved Active X は当該 Auth user の承認済みリンクだけ許可する", () => {
  const base = {
    requireActiveXId: false,
    requireApprovedActiveXId: true,
    approvedXIds: ["owned_x"],
  };

  assert.equal(
    evaluateActiveXWriteAccess({
      ...base,
      activeXId: null,
      approvalStatus: null,
    }),
    "active_x_required",
  );
  assert.equal(
    evaluateActiveXWriteAccess({
      ...base,
      activeXId: "owned_x",
      approvalStatus: "rejected",
    }),
    "active_x_rejected",
  );
  assert.equal(
    evaluateActiveXWriteAccess({
      ...base,
      activeXId: "other_x",
      approvalStatus: "approved",
    }),
    "active_x_not_approved",
  );
  assert.equal(
    evaluateActiveXWriteAccess({
      ...base,
      activeXId: "owned_x",
      approvalStatus: "approved",
    }),
    null,
  );
});

test("spreadsheet and legacy import keep separate CostGuard feature keys", () => {
  assert.equal(isWriteFeatureKey("admin_spreadsheet"), true);
  assert.equal(isWriteFeatureKey("admin_legacy_import"), true);
});

test("manage and admin video status keep separate CostGuard feature keys", () => {
  assert.equal(isWriteFeatureKey("manage_video_status"), true);
  assert.equal(isWriteFeatureKey("admin_video_status"), true);
});
