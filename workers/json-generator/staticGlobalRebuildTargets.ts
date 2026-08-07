/** 1 invocation で必ず 1 件だけ処理すべき global static rebuild target。 */
export const GLOBAL_STATIC_REBUILD_TARGET_TYPES = new Set([
  "top",
  "top_slot_stats",
  "list_recent",
  "list_popular",
  "events_index",
  "search_index",
  "users_index",
  "recommend_core",
  "recommend",
  "rules",
  "youtube_related_blocklist",
  "random_video_pool",
]);

export function isGlobalStaticRebuildTarget(targetType: string): boolean {
  return GLOBAL_STATIC_REBUILD_TARGET_TYPES.has(targetType);
}

export function staticRebuildArtifactTargetId(
  targetType: string,
  targetId: string,
): string {
  return isGlobalStaticRebuildTarget(targetType) ? "global" : targetId;
}
