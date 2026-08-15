import { getEnv } from "@/lib/cloudflare";
import { serveManageXIcon } from "@/lib/media/manageXIcon";

/**
 * Manage 専用の短寿命署名 URL。
 * この route は署名検証後に R2 を読むだけで、D1 ACL は参照しない。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key?: string[] }> },
): Promise<Response> {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch {
    // Bindings/secret の欠落を、任意 key の存在情報へ変換しない。
    return new Response("Not found", { status: 404 });
  }
  const { key } = await params;
  const rawKey = key?.join("/") ?? "";
  return serveManageXIcon(env, rawKey, request);
}
