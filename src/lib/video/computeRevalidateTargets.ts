import { publicVideoRevalidationPaths } from "./publicVideoRevalidationPaths.ts";

export function computeVideoRevalidatePaths(args: {
  videoId: string;
  previousYoutubeVideoId: string | null;
  nextYoutubeVideoId: string | null;
  primaryEventId: string | null;
  youtubeChanged: boolean;
}): string[] {
  const paths = new Set<string>(["/", "/list", "/dashboard"]);
  // Both CURRENT detail aliases can be cached independently. Invalidate the
  // internal route even when the YouTube alias did not change.
  for (const path of publicVideoRevalidationPaths(args.videoId, args.previousYoutubeVideoId)) {
    paths.add(path);
  }
  if (args.youtubeChanged) {
    // Invalidate the new alias as well as the old one on YouTube ID changes.
    for (const path of publicVideoRevalidationPaths(args.videoId, args.nextYoutubeVideoId)) {
      paths.add(path);
    }
  }
  if (args.primaryEventId) {
    paths.add(`/event/${args.primaryEventId}`);
    paths.add(`/event/${args.primaryEventId}/slots`);
  }
  return Array.from(paths);
}

export function computeStaticRebuildFlags(args: {
  canEditIdentity: boolean;
  allowSubmitterChange: boolean;
  displayNameChanged: boolean;
  iconChanged: boolean;
  titleChanged?: boolean;
  youtubeChanged?: boolean;
  partChanged?: boolean;
  canEditPrimaryEvent: boolean;
  hasEventIdsField: boolean;
  memberAggregationChanged?: boolean;
}): {
  identityChanged: boolean;
  eventMembershipChanged: boolean;
  eventProjectionChanged: boolean;
  creatorAggregationChanged: boolean;
  randomPoolCardChanged: boolean;
} {
  const identityChanged =
    args.canEditIdentity &&
    (args.displayNameChanged || args.iconChanged || args.allowSubmitterChange);
  const eventMembershipChanged =
    args.canEditPrimaryEvent && args.hasEventIdsField;
  const creatorAggregationChanged = Boolean(args.memberAggregationChanged);
  const eventProjectionChanged =
    Boolean(args.titleChanged) ||
    Boolean(args.youtubeChanged) ||
    Boolean(args.partChanged) ||
    identityChanged ||
    eventMembershipChanged;

  return {
    identityChanged,
    eventMembershipChanged,
    eventProjectionChanged,
    creatorAggregationChanged,
    randomPoolCardChanged: eventProjectionChanged,
  };
}
