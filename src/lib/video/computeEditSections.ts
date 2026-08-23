import type { DB } from "@/lib/db/client";
import type { videos } from "@/lib/db/schema";
import {
  canEditVideo,
  getApprovedXIds,
  loadEffectiveOwnerEditableFieldSet,
  resolveVideoOwnership,
  type VideoEditAccessContext,
  type CanEditVideoPrivilegeMode,
  type VideoOwnership,
} from "@/lib/auth/ownership";
import type { GeneralEditableFieldKey } from "@/lib/video/generalEditPermissions";
import { canAttachInitialYoutubeToSlottedVideo } from "@/lib/video/youtubeAttachEligibility";

export type VideoEditSectionKey =
  | "identity"
  | "basics"
  | "youtube"
  | "credits"
  | "descriptions"
  | "members"
  | "member_chapters"
  | "primary_event";

export interface AllowedVideoEditSections {
  identity: boolean;
  basics: boolean;
  youtube: boolean;
  credits: boolean;
  descriptions: boolean;
  members: boolean;
  member_chapters: boolean;
  primary_event: boolean;
}

const SECTION_KEYS: Array<{ section: VideoEditSectionKey; key: Parameters<typeof canEditVideo>[0]["requiredKey"] }> = [
  { section: "identity", key: "video.identity" },
  { section: "basics", key: "video.basics" },
  { section: "youtube", key: "video.youtube_id" },
  { section: "credits", key: "video.credits" },
  { section: "descriptions", key: "video.descriptions" },
  { section: "members", key: "video.members" },
  { section: "member_chapters", key: "video.member_chapters" },
  { section: "primary_event", key: "video.primary_event" },
];

export async function computeAllowedVideoEditSections(args: {
  db: DB;
  user: { id: string; role?: string | null };
  video: typeof videos.$inferSelect;
  privilegeMode: CanEditVideoPrivilegeMode;
  generalFields?: Set<GeneralEditableFieldKey>;
  /** Reuse writeGuard's authoritative approved X snapshot when available. */
  approvedXUserIds?: readonly string[];
  /** Reuse the caller's request-local ownership result when available. */
  ownership?: VideoOwnership;
  /** Reuse one request-local authorization snapshot for every section. */
  accessContext?: VideoEditAccessContext;
}): Promise<AllowedVideoEditSections> {
  const generalFields =
    args.privilegeMode === "normal"
      ? (args.generalFields ?? args.accessContext?.ownerEditableFields ??
        (await loadEffectiveOwnerEditableFieldSet(args.db, args.video)))
      : undefined;
  const approvedXUserIds = args.approvedXUserIds
    ? Array.from(args.approvedXUserIds)
    : args.accessContext?.approvedXUserIds
      ? Array.from(args.accessContext.approvedXUserIds)
      : await getApprovedXIds(args.db, args.user.id);
  const ownership =
    args.ownership ?? args.accessContext?.ownership ??
    (await resolveVideoOwnership({
      db: args.db,
      userId: args.user.id,
      video: args.video,
      approvedXUserIds,
    }));
  const results = await Promise.all(
    SECTION_KEYS.map(async ({ section, key }) => ({
      section,
      allowed: await canEditVideo({
        db: args.db,
        user: args.user,
        video: args.video,
        requiredKey: key,
        privilegeMode: args.privilegeMode,
        approvedXUserIds,
        ownership,
        ...(generalFields !== undefined ? { generalFields } : {}),
        ...(args.accessContext ? { accessContext: args.accessContext } : {}),
      }),
    })),
  );
  const out: AllowedVideoEditSections = {
    identity: false,
    basics: false,
    youtube: false,
    credits: false,
    descriptions: false,
    members: false,
    member_chapters: false,
    primary_event: false,
  };
  for (const { section, allowed } of results) {
    out[section] = allowed;
  }
  // When the general registry denies YouTube, retain the historical narrow
  // first-attachment exception for slotted creator submissions.
  out.youtube =
    out.youtube ||
    canAttachInitialYoutubeToSlottedVideo({
      sourceType: args.video.source_type,
      schedulingType: args.video.scheduling_type,
      visibilityStatus: args.video.visibility_status,
      youtubeVideoId: args.video.youtube_video_id,
      privilegeMode: args.privilegeMode,
      isCreatorOwner: ownership.isCreatorOwner,
    });
  return out;
}

export function hasAnyVideoEditSection(sections: AllowedVideoEditSections): boolean {
  return Object.values(sections).some(Boolean);
}
