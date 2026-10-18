export const MIN_SLOTS_PER_VIDEO = 1;
export const MAX_SLOTS_PER_VIDEO = 20;

export function normalizeMaxSlotsPerVideo(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return MIN_SLOTS_PER_VIDEO;
  return Math.min(
    MAX_SLOTS_PER_VIDEO,
    Math.max(MIN_SLOTS_PER_VIDEO, Math.floor(n)),
  );
}
