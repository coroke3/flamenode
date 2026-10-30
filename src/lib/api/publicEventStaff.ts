// Compatibility bridge: CURRENT Next consumers retain this import path (MIG-0647).
export {
  PUBLIC_EVENT_STAFF_SCHEMA_VERSION,
  PUBLIC_EVENT_STAFF_MAX_ITEMS,
  PVSF_PUBLIC_API_ORIGIN,
  PVSF_PUBLIC_API_ORIGINS,
  parsePublicEventId,
  normalizePublicEventStaffArtifact,
  isPvsfPublicApiOrigin,
  resolvePvsfPublicApiOrigin,
} from "@flamenode/server-core/publicData/publicEventStaff";
export type {
  PublicEventStaffItemDto,
  PublicEventStaffDto,
} from "@flamenode/server-core/publicData/publicEventStaff";
