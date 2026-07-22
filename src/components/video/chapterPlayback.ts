export interface ChapterTimeEntry {
  id: string;
  chapter_time: number;
}

/**
 * 再生位置に対応するアクティブチャプター ID。
 * `chapter_time <= currentTime` を満たす最後のチャプター（配列順）を返す。
 */
export function findActiveChapterId(
  chapters: readonly ChapterTimeEntry[],
  currentTime: number,
): string | null {
  if (!Number.isFinite(currentTime) || chapters.length === 0) return null;

  let activeId: string | null = null;
  for (const chapter of chapters) {
    if (chapter.chapter_time <= currentTime) {
      activeId = chapter.id;
    }
  }
  return activeId;
}
