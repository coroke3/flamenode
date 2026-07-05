import type { WriteGuardDenyReason } from "@/lib/auth/writeGuard";

export interface VideoActionResult {
  ok: boolean;
  message?: string;
  videoId?: string;
  youtubeVideoId?: string;
  eventId?: string;
  reason?: WriteGuardDenyReason;
}
