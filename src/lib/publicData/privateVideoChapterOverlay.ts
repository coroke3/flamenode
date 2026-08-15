export type VideoChapterOverlayEntry = {
  id: string;
  chapter_time: number;
  chapter_label: string;
  visibility: "public" | "private";
  note: string | null;
  author_name: string | null;
  author_icon: string | null;
};

/**
 * Public chapters come from the R2 projection. Private chapters are an
 * authenticated D1 overlay. Keep one deterministic, deduplicated list so a
 * stale projection can never duplicate a row returned by the overlay query.
 */
export function mergeVideoChapterOverlay(
  publicChapters: readonly VideoChapterOverlayEntry[],
  privateChapters: readonly VideoChapterOverlayEntry[],
): VideoChapterOverlayEntry[] {
  const byId = new Map<string, VideoChapterOverlayEntry>();

  for (const chapter of publicChapters) {
    if (chapter.visibility !== "public") continue;
    if (!chapter.id || !Number.isFinite(chapter.chapter_time)) continue;
    byId.set(chapter.id, { ...chapter, visibility: "public" });
  }

  for (const chapter of privateChapters) {
    if (chapter.visibility !== "private") continue;
    if (!chapter.id || !Number.isFinite(chapter.chapter_time)) continue;
    // The authenticated D1 overlay is authoritative if a malformed/stale
    // public artifact happens to reuse an id.
    byId.set(chapter.id, { ...chapter, visibility: "private" });
  }

  return Array.from(byId.values()).sort((left, right) => {
    const timeDiff = left.chapter_time - right.chapter_time;
    if (timeDiff !== 0) return timeDiff;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

