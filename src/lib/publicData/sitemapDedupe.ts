/**
 * CURRENT sitemap URL de-duplication (pure helper).
 * Keep the first entry in static -> dynamic order: public fixed routes win
 * over corrupted legacy video aliases and duplicate R2 recent-index rows.
 */
export function dedupeSitemapEntries<T extends { url: string }>(entries: readonly T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}
