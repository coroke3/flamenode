import {
  cacheControlForFreshness,
  computedEventLegacyFlags,
  resolveEventFreshness,
} from "../shared/eventVisibility.ts";

export { cacheControlForFreshness, resolveEventFreshness };

export function enrichEventRowForStaticJson(
  row: Record<string, unknown>,
  now: number = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  const flags = computedEventLegacyFlags({
    visibility_status: row.visibility_status as string | null,
    entry_start_time: (row.entry_start_time as number | null) ?? null,
    entry_end_time: (row.entry_end_time as number | null) ?? null,
    now,
  });
  return { ...row, ...flags };
}
