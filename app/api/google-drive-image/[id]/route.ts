import { proxyExternalImage } from "@/lib/media/externalImageProxy";

export const dynamic = "force-dynamic";

const GOOGLE_DRIVE_ID_RE = /^[A-Za-z0-9_-]{6,}$/;
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="Image unavailable"><rect width="160" height="160" fill="#15181d"/><circle cx="80" cy="64" r="28" fill="#c9ff00"/><path d="M36 132c7-26 24-42 44-42s37 16 44 42H36Z" fill="#f4f7ef"/></svg>`;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id?: string }> },
): Promise<Response> {
  const { id: rawId } = await params;
  const id = (rawId ?? "").trim();
  if (!GOOGLE_DRIVE_ID_RE.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  return await proxyExternalImage({
    namespace: "google-drive-image",
    cacheKey: id,
    upstreamUrl: `https://lh3.googleusercontent.com/d/${id}`,
    fallbackSvg: FALLBACK_SVG,
    maxObjectBytes: MAX_OBJECT_BYTES,
  });
}
