import assert from "node:assert/strict";
import { test } from "node:test";
import { canAutoBindUnassignedReservation } from "./reservationBindIdentityCore.ts";

test("approved identity with one canonical target can bind", () => {
  assert.equal(
    canAutoBindUnassignedReservation({
      bindTargetXId: "@X1",
      approvedXIds: ["x1", " X1 "],
      pendingXIds: ["@x1", "x1"],
    }),
    true,
  );
});

test("a different pending identity fails closed", () => {
  assert.equal(
    canAutoBindUnassignedReservation({
      bindTargetXId: "x1",
      approvedXIds: ["x1"],
      pendingXIds: ["x2"],
    }),
    false,
  );
});

test("multiple approved identities or a mismatched target fail closed", () => {
  assert.equal(
    canAutoBindUnassignedReservation({
      bindTargetXId: "x1",
      approvedXIds: ["x1", "x2"],
      pendingXIds: [],
    }),
    false,
  );
  assert.equal(
    canAutoBindUnassignedReservation({
      bindTargetXId: "x2",
      approvedXIds: ["x1"],
      pendingXIds: [],
    }),
    false,
  );
});
