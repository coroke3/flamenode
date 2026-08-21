/** Cache API TTL（秒）。鮮度目標は docs/operations/static-delivery.md を参照。 */
export const PUBLIC_JSON_CACHE_TTL_SEC = {
  videoDetail: 180,
  eventDetail: 120,
  eventsIndex: 180,
  userDetail: 60,
  listRecent: 180,
  listPopular: 600,
  searchIndex: 300,
  usersIndex: 600,
  top: 600,
  // 枠数だけは小さい projection を個別更新するため、top 本体より短く保つ。
  // reserve/release 後の top/slot-stats.v1.json を通常30秒以内に再取得する。
  topSlotStats: 30,
  recommend: 600,
  rules: 3600,
  blocklistPool: 600,
} as const;
