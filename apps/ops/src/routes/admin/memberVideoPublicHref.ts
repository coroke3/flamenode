// MIG-0730 U02ci: CURRENT-compatible same-origin public video path for the
// unmounted admin member read view and editor footer. Never trust legacy URLs.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SAFE_INTERNAL_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function memberVideoPublicHref(video: {
  id: string;
  youtube_video_id?: string | null;
}): string {
  const raw = video.youtube_video_id?.trim();
  if (raw) {
    if (YOUTUBE_ID_RE.test(raw)) return `/${raw}`;
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") {
        const host = url.hostname.toLowerCase().replace(/^www\./, "");
        if (host === "youtu.be") {
          const id = url.pathname.split("/").filter(Boolean)[0];
          if (id && YOUTUBE_ID_RE.test(id)) return `/${id}`;
        } else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
          const queryId = url.searchParams.get("v");
          if (queryId && YOUTUBE_ID_RE.test(queryId)) return `/${queryId}`;
          const segments = url.pathname.split("/").filter(Boolean);
          const index = segments.findIndex(segment =>
            ["shorts", "embed", "live", "v"].includes(segment));
          if (index >= 0 && segments[index + 1] &&
              YOUTUBE_ID_RE.test(segments[index + 1]!)) {
            return `/${segments[index + 1]}`;
          }
        }
      }
    } catch { /* Invalid URLs fall through to the safe internal ID. */ }
  }
  return SAFE_INTERNAL_ID_RE.test(video.id) ? `/${video.id}` : "/list";
}
