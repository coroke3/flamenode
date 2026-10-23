import type { CanEditVideoPrivilegeMode } from "./ownership.ts";
import type { VideoEditSectionKey } from "./editSections.ts";

/** Sections of the video edit form (SA-089 and the edit page). */
export type VideoEditSection =
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

/** The permission key each section is checked against (one canEditVideo call each). */
export const VIDEO_EDIT_SECTION_PERMISSION_KEYS: ReadonlyArray<{
  section: VideoEditSection;
  key: VideoEditSectionKey;
}> = [
  { section: "identity", key: "video.identity" },
  { section: "basics", key: "video.basics" },
  { section: "youtube", key: "video.youtube_id" },
  { section: "credits", key: "video.credits" },
  { section: "descriptions", key: "video.descriptions" },
  { section: "members", key: "video.members" },
  { section: "member_chapters", key: "video.member_chapters" },
  { section: "primary_event", key: "video.primary_event" },
];

/**
 * The one narrow exception to the normal YouTube-field policy.
 *
 * A slotted creator may attach the first YouTube ID while the submission is
 * pending or already public as an information-only page. This is deliberately
 * a pure predicate: ownership and privilege have to be resolved by the caller
 * from the authoritative request context, and no form value is used as an
 * ownership signal. Once an ID exists, this exception no longer applies.
 */
export function canAttachInitialYoutubeToSlottedVideo(input: {
  sourceType: string | null | undefined;
  schedulingType: string | null | undefined;
  visibilityStatus: string | null | undefined;
  youtubeVideoId: string | null | undefined;
  privilegeMode: CanEditVideoPrivilegeMode;
  isCreatorOwner: boolean;
}): boolean {
  return (
    input.privilegeMode === "normal" &&
    input.isCreatorOwner === true &&
    input.sourceType === "youtube" &&
    input.schedulingType === "slotted" &&
    !input.youtubeVideoId?.trim()
  );
}

/**
 * Combine the per-section permission results. When the general registry
 * denies YouTube, the historical narrow first-attachment exception for
 * slotted creator submissions still applies.
 */
export function resolveAllowedVideoEditSections(args: {
  results: ReadonlyArray<{ section: VideoEditSection; allowed: boolean }>;
  video: {
    source_type: string | null | undefined;
    scheduling_type: string | null | undefined;
    visibility_status: string | null | undefined;
    youtube_video_id: string | null | undefined;
  };
  privilegeMode: CanEditVideoPrivilegeMode;
  isCreatorOwner: boolean;
}): AllowedVideoEditSections {
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
  for (const { section, allowed } of args.results) {
    out[section] = allowed;
  }
  out.youtube =
    out.youtube ||
    canAttachInitialYoutubeToSlottedVideo({
      sourceType: args.video.source_type,
      schedulingType: args.video.scheduling_type,
      visibilityStatus: args.video.visibility_status,
      youtubeVideoId: args.video.youtube_video_id,
      privilegeMode: args.privilegeMode,
      isCreatorOwner: args.isCreatorOwner,
    });
  return out;
}

export function hasAnyVideoEditSection(sections: AllowedVideoEditSections): boolean {
  return Object.values(sections).some(Boolean);
}
