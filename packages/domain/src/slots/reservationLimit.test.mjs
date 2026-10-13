import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_SLOT_RESERVATIONS_PER_XID,
  normalizeSlotReservationLimit,
  slotReservationLimitMessage,
} from "./reservationLimit.ts";

test("MAX_SLOT_RESERVATIONS_PER_XID is 100", () => {
  assert.equal(MAX_SLOT_RESERVATIONS_PER_XID, 100);
});

test("normalizeSlotReservationLimit maps nullish and non-finite input to 0", () => {
  assert.equal(normalizeSlotReservationLimit(null), 0);
  assert.equal(normalizeSlotReservationLimit(undefined), 0);
  assert.equal(normalizeSlotReservationLimit(NaN), 0);
  assert.equal(normalizeSlotReservationLimit(Infinity), 0);
  assert.equal(normalizeSlotReservationLimit(-Infinity), 0);
  assert.equal(normalizeSlotReservationLimit("abc"), 0);
});

test("normalizeSlotReservationLimit floors and clamps to 0..100", () => {
  assert.equal(normalizeSlotReservationLimit(-1), 0);
  assert.equal(normalizeSlotReservationLimit(0), 0);
  assert.equal(normalizeSlotReservationLimit(2.9), 2);
  assert.equal(normalizeSlotReservationLimit("5"), 5);
  assert.equal(normalizeSlotReservationLimit(100), 100);
  assert.equal(normalizeSlotReservationLimit(150), 100);
});

test("slotReservationLimitMessage is empty when the normalized limit is 0", () => {
  assert.equal(slotReservationLimitMessage(0), "");
  assert.equal(slotReservationLimitMessage(-5), "");
  assert.equal(slotReservationLimitMessage(NaN), "");
});

test("slotReservationLimitMessage keeps the exact Japanese text", () => {
  assert.equal(
    slotReservationLimitMessage(3),
    "このイベントでは、1つのX IDにつき最大3件まで枠を確保できます。連続枠は1件として数えます。",
  );
  assert.equal(
    slotReservationLimitMessage(2.9),
    "このイベントでは、1つのX IDにつき最大2件まで枠を確保できます。連続枠は1件として数えます。",
  );
  assert.equal(
    slotReservationLimitMessage(150),
    "このイベントでは、1つのX IDにつき最大100件まで枠を確保できます。連続枠は1件として数えます。",
  );
});
