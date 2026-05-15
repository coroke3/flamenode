import { getEnv } from "@/lib/cloudflare";

export async function GET(
  _req: Request,
  { params }: { params: { key?: string[] } },
): Promise<Response> {
  const env = getEnv();
  if (!env.BUCKET) {
    return new Response("Bucket not configured", { status: 500 });
  }
  const rawKey = params.key?.join("/") ?? "";
  if (!rawKey || rawKey.includes("..")) {
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
