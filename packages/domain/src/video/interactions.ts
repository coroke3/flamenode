/**
 * Like/bookmark decisions for SA-087 (toggleVideoInteraction).
 *
 * CURRENT records a new interaction for the Auth User
 * (`video_interactions_auth`). The D-03 fan-out of existing rows to every
 * approved owner X is a separate data-migration rule (MIG-0605 U05 /
 * MIG-0702) and deliberately has no code here.
 */

/** Next `videos.app_like_count` after a like is (de)activated; never negative. */
export function nextVideoAppLikeCount(current: number, active: boolean): number {
  return active ? current + 1 : Math.max(0, current - 1);
}
