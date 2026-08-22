import type { WriteGuardDenyReason } from "@/lib/auth/writeGuard";
import type { PendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";

export interface VideoActionResult extends PendingPublicReflection {
  ok: boolean;
  message?: string;
  videoId?: string;
  youtubeVideoId?: string;
  eventId?: string;
  /** 枠投稿を保存したが、公開前にYouTube URLの追加が必要な状態。 */
  requiresYoutubeBeforePublish?: boolean;
  reason?: WriteGuardDenyReason;
}
