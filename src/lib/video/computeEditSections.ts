import type { DB } from "@/lib/db/client";
import type { videos } from "@/lib/db/schema";
import {
  canEditVideo,
  type VideoEditAccessContext,
  type CanEditVideoPrivilegeMode,
} from "@/lib/auth/ownership";
import {
  resolveAllowedVideoEditSections,
  VIDEO_EDIT_SECTION_PERMISSION_KEYS,
  type AllowedVideoEditSections,
} from "@flamenode/domain/video";

// Section table and result combination live in @flamenode/domain/video
// (editSectionAccess.ts); this adapter only runs the per-key DB checks.
export {
  type VideoEditSection as VideoEditSectionKey,
  type AllowedVideoEditSections,
  hasAnyVideoEditSection,
} from "@flamenode/domain/video";

export async function computeAllowedVideoEditSections(args: {
  db: DB;
  user: { id: string; role?: string | null };
  video: typeof videos.$inferSelect;
  privilegeMode: CanEditVideoPrivilegeMode;
  /** One request-local authorization snapshot for every section. */
  accessContext: VideoEditAccessContext;
}): Promise<AllowedVideoEditSections> {
  const results = await Promise.all(
    VIDEO_EDIT_SECTION_PERMISSION_KEYS.map(async ({ section, key }) => ({
      section,
      allowed: await canEditVideo({
        db: args.db,
        user: args.user,
        video: args.video,
        requiredKey: key,
        privilegeMode: args.privilegeMode,
        accessContext: args.accessContext,
      }),
    })),
  );
  return resolveAllowedVideoEditSections({
    results,
    video: args.video,
    privilegeMode: args.privilegeMode,
    isCreatorOwner: args.accessContext.ownership.isCreatorOwner,
  });
}
