import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import * as bridge from "./slotReservationLimit.ts";
import * as domain from "@flamenode/domain/slots/reservationLimit";

test("legacy slotReservationLimit.ts re-exports the same three domain bindings", () => {
  assert.deepEqual(Object.keys(bridge).sort(), [
    "MAX_SLOT_RESERVATIONS_PER_XID",
    "normalizeSlotReservationLimit",
    "slotReservationLimitMessage",
  ]);
  assert.equal(bridge.MAX_SLOT_RESERVATIONS_PER_XID, domain.MAX_SLOT_RESERVATIONS_PER_XID);
  assert.equal(bridge.normalizeSlotReservationLimit, domain.normalizeSlotReservationLimit);
  assert.equal(bridge.slotReservationLimitMessage, domain.slotReservationLimitMessage);
});

test("legacy bridge keeps the CURRENT numeric and message contract", () => {
  assert.equal(bridge.normalizeSlotReservationLimit(null), 0);
  assert.equal(bridge.normalizeSlotReservationLimit(2.9), 2);
  assert.equal(bridge.normalizeSlotReservationLimit(150), 100);
  assert.equal(bridge.slotReservationLimitMessage(0), "");
  assert.equal(
    bridge.slotReservationLimitMessage(3),
    "このイベントでは、1つのX IDにつき最大3件まで枠を確保できます。連続枠は1件として数えます。",
  );
});

test("legacy slotReservationLimit.ts is a pure re-export bridge", () => {
  const source = fs.readFileSync("src/lib/slots/slotReservationLimit.ts", "utf8");
  assert.match(source, /from "@flamenode\/domain\/slots\/reservationLimit"/);
  assert.doesNotMatch(source, /\bfunction\b|=>|\bconst\b|\blet\b/);
});
