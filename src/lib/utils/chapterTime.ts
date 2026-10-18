/**
 * Legacy compatibility bridge. Canonical definitions live in
 * @flamenode/domain/video (packages/domain/src/video/chapterTime.ts).
 */
export {
  type ChapterTimeErrorCode,
  type ChapterTimeValidationResult,
  type ValidateChapterTimeOptions,
  validateChapterTime,
  formatChapterTime,
} from "@flamenode/domain/video";
