// MIG-0305 U03: the slot reservation decision cores are thin re-export
// bridges of @flamenode/domain/slots/* (one implementation each).
import assert from "node:assert/strict";
import test from "node:test";
import * as domainSlotIdentity from "@flamenode/domain/slots/slotIdentity";
import * as domainReleaseGroups from "@flamenode/domain/slots/releaseGroups";
import * as domainReservationIdentity from "@flamenode/domain/slots/reservationIdentity";
import * as domainReservationBind from "@flamenode/domain/slots/reservationBind";
import * as domainReservationGroups from "@flamenode/domain/slots/reservationGroups";
import * as legacySlotIdentity from "./slotIdentityCore.ts";
import * as legacyUserSlot from "./userSlotCore.ts";
import * as legacyReservationIdentity from "./reservationIdentityCore.ts";
import * as legacyReservationBind from "./reservationBindIdentityCore.ts";
import * as legacyReservationGroups from "../slot/reservationGroupsCore.ts";

const BRIDGES = [
  ["slotIdentityCore", legacySlotIdentity, domainSlotIdentity, [
    "canActAsSlotActor",
    "canActAsSlotSubmitter",
    "resolveSlotGroupIdentity",
    "resolveSlotSubmissionRelation",
    "resolveSlotViewerRelation",
  ]],
  ["userSlotCore", legacyUserSlot, domainReleaseGroups, ["buildReleaseGroupDecisions"]],
  ["reservationIdentityCore", legacyReservationIdentity, domainReservationIdentity, [
    "SLOT_RESERVATION_X_REQUEST_TYPES",
    "resolveReservationXIdentityFromPending",
  ]],
  ["reservationBindIdentityCore", legacyReservationBind, domainReservationBind, [
    "canAutoBindUnassignedReservation",
  ]],
  ["reservationGroupsCore", legacyReservationGroups, domainReservationGroups, [
    "buildSlotReservationGroupCandidates",
    "collectSlotReservationAmbiguities",
    "resolveSlotReservationSubject",
    "subjectsEqual",
  ]],
];

for (const [label, legacy, domain, expected] of BRIDGES) {
  test(`${label} re-exports the domain slot policy`, () => {
    assert.deepEqual(Object.keys(legacy).sort(), expected);
    for (const name of expected) {
      assert.equal(legacy[name], domain[name], `${label}.${name} is a copy, not a re-export`);
    }
  });
}
