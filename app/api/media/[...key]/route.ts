import {
  CloudflareBindingsUnavailableError,
  getEnv,
} from "@/lib/cloudflare";
import {
  getCachedPublicMediaResponse,
  isValidPublicMediaKey,
  servePublicMedia,
} from "@/lib/media/publicMedia";

const UNAVAILABLE_HEADERS = {
  "Cache-Control": "no-store",
  "Retry-After": "30",
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key?: string[] }> },
): Promise<Response> {
  const { key } = await params;
  const rawKey = key?.join("/") ?? "";

  if (!isValidPublicMediaKey(rawKey)) return new Response("Not found", { status: 404 });

  const cached = await getCachedPublicMediaResponse(request, rawKey);
  if (cached) return cached;

  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch (error) {
    if (!(error instanceof CloudflareBindingsUnavailableError)) throw error;
    console.error("[public-media] runtime bindings unavailable", {
      missing: error.missing,
    });
    return new Response("Storage temporarily unavailable", {
      status: 503,
      headers: UNAVAILABLE_HEADERS,
    });
  }
  if (!env.BUCKET || !env.DB) {
    return new Response("Storage temporarily unavailable", {
      status: 503,
      headers: UNAVAILABLE_HEADERS,
    });
  }
  return servePublicMedia(env, rawKey, request, { skipEdgeCacheLookup: true });
}
