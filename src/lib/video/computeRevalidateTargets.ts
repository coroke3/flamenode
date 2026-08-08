export function computeVideoRevalidatePaths(args: {
  videoId: string;
  previousYoutubeVideoId: string | null;
  nextYoutubeVideoId: string | null;
  primaryEventId: string | null;
  youtubeChanged: boolean;
}): string[] {
  const paths = new Set<string>([
    "/",
    "/list",
    "/dashboard",
    `/${args.previousYoutubeVideoId ?? args.videoId}`,
  ]);
  if (args.youtubeChanged && args.nextYoutubeVideoId) {
    paths.add(`/${args.nextYoutubeVideoId}`);
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
  membersSectionTouched?: boolean;
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
  const creatorAggregationChanged = Boolean(args.membersSectionTouched);
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
    randomPoolCardChanged:
      eventProjectionChanged ||
      creatorAggregationChanged,
  };
}
