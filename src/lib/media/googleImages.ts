const GOOGLE_DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{6,}$/;

export function googleDriveImageCacheUrl(fileId: string): string {
  const id = fileId.trim();
  if (!GOOGLE_DRIVE_FILE_ID_RE.test(id)) return "";
  return `/api/google-drive-image/${id}`;
}

export function extractGoogleDriveImageId(
  input: string | null | undefined,
): string | null {
  const raw = input?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    const byQuery = url.searchParams.get("id");
    if (
      host === "drive.google.com" &&
      byQuery &&
      GOOGLE_DRIVE_FILE_ID_RE.test(byQuery)
    ) {
      return byQuery;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (host === "drive.google.com") {
      const index = parts.findIndex((part) => part === "d");
      const id = index >= 0 ? parts[index + 1] : null;
      return id && GOOGLE_DRIVE_FILE_ID_RE.test(id) ? id : null;
    }

    if (host === "lh3.googleusercontent.com" && parts[0] === "d") {
      const id = parts[1] ?? null;
      return id && GOOGLE_DRIVE_FILE_ID_RE.test(id) ? id : null;
    }
  } catch {
    /* not an absolute URL */
  }

  return null;
}

export function cachedGoogleImageUrl(
  input: string | null | undefined,
): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  if (raw.startsWith("/api/google-drive-image/")) return raw;

  const id = extractGoogleDriveImageId(raw);
  return id ? googleDriveImageCacheUrl(id) : raw;
}
