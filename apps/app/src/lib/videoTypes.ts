// Port of CURRENT src/lib/video/types.ts (MIG-0738). Same output.
import type { PendingPublicReflection } from "./publicReflectionNotice.js";

export type WriteGuardDenyReason =
  | "unauthenticated"
  | "db_unavailable"
  | "banned"
  | "tos_required"
  | "tos_reaccept_required"
  | "maintenance_mode"
  | "cost_guard_blocked"
  | "forbidden"
  | "active_x_required"
  | "active_x_rejected"
  | "active_x_not_approved";

export interface VideoActionResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
  videoId?: string;
  youtubeVideoId?: string;
  eventId?: string;
  reason?: WriteGuardDenyReason;
}
