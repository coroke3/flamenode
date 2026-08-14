
import { getEnv } from "@/lib/cloudflare";
import { servePublicMedia } from "@/lib/media/publicMedia";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key?: string[] }> },
): Promise<Response> {
  const env = getEnv();
  if (!env.BUCKET || !env.DB) {
    return new Response("Storage not configured", { status: 500 });
  }
  const { key } = await params;
  const rawKey = key?.join("/") ?? "";
  return servePublicMedia(env, rawKey, request);
}
