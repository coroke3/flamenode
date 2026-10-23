/**
 * Legacy compatibility bridge (MIG-0305 U03).
 * Canonical definitions live in @flamenode/domain/slots/reservationIdentity
 * (packages/domain/src/slots/reservationIdentity.ts). Export surface is kept identical
 * to the pre-extraction file.
 */
export {
  SLOT_RESERVATION_X_REQUEST_TYPES,
  type ReservationXIdentity,
  resolveReservationXIdentityFromPending,
} from "@flamenode/domain/slots/reservationIdentity";
