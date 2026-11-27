/** CURRENT event-template text normalization; no renderer or framework dependency. */
export const MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH = 10_000;

export function normalizeYoutubeDescriptionTemplate(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  return normalized || null;
}
