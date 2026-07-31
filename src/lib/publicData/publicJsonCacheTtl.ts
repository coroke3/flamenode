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
  recommend: 600,
  rules: 3600,
  blocklistPool: 600,
} as const;
