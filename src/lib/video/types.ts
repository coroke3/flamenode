import type { WriteGuardDenyReason } from "@/lib/auth/writeGuard";
import type { PendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";

export interface VideoActionResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
  videoId?: string;
  youtubeVideoId?: string;
  eventId?: string;
  reason?: WriteGuardDenyReason;
}
