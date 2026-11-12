// Compatibility bridge (MIG-0650, D-15-2): the canonical D1 rebuild-event lookup lives in server-core.
export { loadVideoRebuildEventIds } from "@flamenode/server-core/video/rebuildEventIds";

// Pure visibility helpers remain owned by @flamenode/domain/video.
export {
  SAME_VIDEO_STATUS_MESSAGE,
  mergeVideoRebuildEventIds,
  monotonicVideoUpdatedAt,
} from "@flamenode/domain/video";
