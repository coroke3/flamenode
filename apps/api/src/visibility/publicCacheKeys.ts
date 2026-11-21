/**
 * D-13-42: Worker-local copy of the public object keys cleared by a video
 * visibility transition. Keep these literals in parity with the CURRENT
 * generators; videoTransitionHost.test.mjs detects drift.
 */
export const VIDEO_VISIBILITY_STATIC_OBJECT_KEYS = [
  "videos/random-pool.v1.json",
  "youtube/related-blocklist.v1.json",
  "top/sections/recommended.v1.json",
  "top/sections/latest.v1.json",
  "top/sections/nostalgic.v1.json",
  "top/sections/stats.v1.json",
] as const;

export const VIDEO_VISIBILITY_USER_MAX_PAGES = 5;

export function videoVisibilityEventObjectKeys(eventId: string): string[] {
  return [
    `events/${eventId}.json`,
    `events/${eventId}/base.v1.json`,
    `events/${eventId}/slots.v1.json`,
    `events/${eventId}/release.v1.json`,
  ];
}
