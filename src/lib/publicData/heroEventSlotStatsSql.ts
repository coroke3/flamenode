/** rebuildTop の slot_stats 用。ヒーロー event_id のみ集計する。 */
export function buildHeroEventSlotStatsSql(eventIds: readonly string[]): string | null {
  if (eventIds.length === 0) return null;
  const placeholders = eventIds.map(() => "?").join(",");
  return `
    SELECT s.event_id,
           SUM(CASE WHEN s.status = 'available' THEN 1 ELSE 0 END) AS available,
           COUNT(*) AS total
    FROM slots AS s
    INNER JOIN events AS e
      ON e.id = s.event_id AND e.visibility_status = 'public'
    WHERE s.event_id IN (${placeholders})
    GROUP BY s.event_id`;
}
