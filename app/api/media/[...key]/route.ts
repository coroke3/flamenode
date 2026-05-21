import { getEnv } from "@/lib/cloudflare";

const PUBLIC_MEDIA_PREFIXES = [
  "video-icons/",
  "xicons/",
  "x-icons/",
  "event-icons/",
  "event-banners/",
] as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key?: string[] }> },
): Promise<Response> {
  const env = getEnv();
  if (!env.BUCKET) {
    return new Response("Bucket not configured", { status: 500 });
  }
  const { key } = await params;
  const rawKey = key?.join("/") ?? "";

  // パスサニタイズ: 空文字列、ディレクトリトラバーサル、Windowsスラッシュ、制御文字のブロック
  if (
    !rawKey ||
    rawKey.includes("..") ||
    rawKey.includes("\\") ||
    /[\x00-\x1F\x7F]/.test(rawKey)
  ) {
    return new Response("Not found", { status: 404 });
  }

  // 許可されたパブリックプレフィックス配下のみアクセス可能にする
  const isAllowed = PUBLIC_MEDIA_PREFIXES.some((prefix) =>
    rawKey.startsWith(prefix),
  );
  if (!isAllowed) {
    return new Response("Not found", { status: 404 });
  }

  const obj = await env.BUCKET.get(rawKey);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}
