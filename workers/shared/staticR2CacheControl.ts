/** R2 object の Cache-Control ヘッダ生成。max-age は Cache API TTL と揃える。 */
export function staticR2CacheControl(
  maxAgeSec: number,
  staleWhileRevalidateSec = Math.max(maxAgeSec * 5, maxAgeSec + 60),
): string {
  const maxAge = Math.max(1, Math.floor(maxAgeSec));
  const swr = Math.max(maxAge, Math.floor(staleWhileRevalidateSec));
  return `public, max-age=${maxAge}, stale-while-revalidate=${swr}`;
}

/** 公開静的 JSON の R2 max-age（秒）。web loader の TTL と整合させる。 */
export const STATIC_R2_MAX_AGE_SEC = {
  top: 600,
  listRecent: 180,
  listPopular: 600,
  eventsIndex: 180,
  searchIndex: 300,
  usersIndex: 600,
  topSlotStats: 600,
  recommend: 600,
  rules: 3600,
  blocklistPool: 600,
  videoDetail: 180,
  eventDetail: 120,
  userDetail: 60,
} as const;
