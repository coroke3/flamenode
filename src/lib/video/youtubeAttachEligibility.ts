import type { CanEditVideoPrivilegeMode } from "@/lib/auth/ownership";

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
