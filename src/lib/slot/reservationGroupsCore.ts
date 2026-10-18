/**
 * Legacy compatibility bridge (MIG-0305 U03).
 * Canonical definitions live in @flamenode/domain/slots/reservationGroups
 * (packages/domain/src/slots/reservationGroups.ts). Export surface is kept identical
 * to the pre-extraction file.
 */
export {
  type SlotReservationSubjectRow,
  type SlotReservationGroupCandidate,
  type SlotReservationAmbiguity,
  type SlotReservationAmbiguousReport,
  type SlotReservationSubject,
  subjectsEqual,
  resolveSlotReservationSubject,
  collectSlotReservationAmbiguities,
  buildSlotReservationGroupCandidates,
} from "@flamenode/domain/slots/reservationGroups";
