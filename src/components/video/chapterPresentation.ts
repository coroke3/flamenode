function normalizeIdentityLabel(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .replace(/^@/, "")
    .toLocaleLowerCase("ja-JP");
}

export function shouldShowChapterAuthor(
  chapterLabel: string,
  authorName: string | null | undefined,
): boolean {
  if (!authorName?.trim()) return false;

  const label = normalizeIdentityLabel(chapterLabel);
  const author = normalizeIdentityLabel(authorName);
  return label.length === 0 || label !== author;
}
