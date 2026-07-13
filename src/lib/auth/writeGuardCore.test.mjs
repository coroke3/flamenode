import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateWriteIdentity } from "./writeGuardCore.ts";

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
