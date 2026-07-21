import { proxyExternalImage } from "@/lib/media/externalImageProxy";
import {
  YOUTUBE_THUMB_SIZES,
  type YoutubeThumbSize,
} from "@/lib/youtube/id";

export const dynamic = "force-dynamic";

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_OBJECT_BYTES = 2 * 1024 * 1024;
const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="サムネイルを取得できません"><rect width="640" height="360" fill="#15181d"/><path d="M278 228V132l92 48-92 48Z" fill="#c9ff00"/><text x="320" y="284" text-anchor="middle" fill="#f4f7ef" font-family="Arial, sans-serif" font-size="24" font-weight="700">サムネイルを取得できません</text></svg>`;

function normalizeSize(raw: string | undefined): YoutubeThumbSize | null {
  const value = (raw ?? "").replace(/\.jpg$/i, "");
  return (YOUTUBE_THUMB_SIZES as readonly string[]).includes(value)
    ? (value as YoutubeThumbSize)
    : null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id?: string; size?: string }> },
): Promise<Response> {
  const { id: rawId, size: rawSize } = await params;
  const id = (rawId ?? "").trim();
  const size = normalizeSize(rawSize);
  if (!YOUTUBE_ID_RE.test(id) || !size) {
    return new Response("Not found", { status: 404 });
  }

  return await proxyExternalImage({
    namespace: "youtube-thumbnail",
    cacheKey: `${id}:${size}`,
    upstreamUrl: `https://i.ytimg.com/vi/${id}/${size}.jpg`,
    fallbackSvg: FALLBACK_SVG,
    maxObjectBytes: MAX_OBJECT_BYTES,
  });
}
