import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SLOT_RESERVATIONS_PER_XID,
  normalizeSlotReservationLimit,
  slotReservationLimitMessage,
} from "@flamenode/domain/slots/reservationLimit";

test("T01 normalizeSlotReservationLimit clamps to 0..MAX and floors", () => {
  const inputs = [null, undefined, -1, 2.9, 150, Infinity, NaN];
  assert.deepEqual(inputs.map(normalizeSlotReservationLimit), [0, 0, 0, 2, MAX_SLOT_RESERVATIONS_PER_XID, 0, 0]);
});

test("T02 slotReservationLimitMessage names the limit", () => {
  assert.equal(
    slotReservationLimitMessage(3),
    "このイベントでは、1つのX IDにつき最大3件まで枠を確保できます。連続枠は1件として数えます。",
  );
});

test("T03 slotReservationLimitMessage is empty when unlimited", () => {
  assert.equal(slotReservationLimitMessage(0), "");
});
