// Ports of CURRENT src/lib/youtube/id.ts (extractYoutubeId, youtubeThumbUrl) and
// src/lib/media/googleImages.ts (cachedGoogleImageUrl). Same inputs, same output URLs.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const GOOGLE_DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{6,}$/;

function extractYoutubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && YOUTUBE_ID_RE.test(id) ? id : null;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && YOUTUBE_ID_RE.test(v)) return v;
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => ["shorts", "embed", "live", "v"].includes(p));
      if (idx >= 0 && parts[idx + 1] && YOUTUBE_ID_RE.test(parts[idx + 1]!)) {
        return parts[idx + 1]!;
      }
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function youtubeThumbUrl(id: string | null | undefined, size: "mqdefault" | "hqdefault" = "hqdefault"): string {
  const youtubeId = extractYoutubeId(id);
  if (!youtubeId) return "";
  return `/api/youtube-thumbnail/${youtubeId}/${size}`;
}

function googleDriveImageCacheUrl(fileId: string): string {
  const id = fileId.trim();
  if (!GOOGLE_DRIVE_FILE_ID_RE.test(id)) return "";
  return `/api/google-drive-image/${id}`;
}

function extractGoogleDriveImageId(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    const byQuery = url.searchParams.get("id");
    if (host === "drive.google.com" && byQuery && GOOGLE_DRIVE_FILE_ID_RE.test(byQuery)) {
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

export function cachedGoogleImageUrl(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  if (raw.startsWith("/api/google-drive-image/")) return raw;
  const id = extractGoogleDriveImageId(raw);
  return id ? googleDriveImageCacheUrl(id) : raw;
}
