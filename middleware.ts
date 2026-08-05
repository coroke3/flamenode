import { NextResponse, type NextRequest } from "next/server";
import { resolveCanonicalHostRedirect } from "@/lib/auth/canonicalHostRedirect";
import { resolveMiddlewareMaintenance } from "@/lib/operationMode/middlewareMaintenance";

/**
 * Edge middleware: 正規host / コストガード / メンテナンスモードの粗い制御。
 *
 * - 設定済みの正規 origin と異なる host は、全経路（`/api/auth`を含む）を
 *   同一path + queryの正規 origin へ戻し、Auth.js Cookieのhost不一致を防ぐ。
 * - Cloudflare runtime の AUTH_URL / NEXT_PUBLIC_SITE_URL を優先する
 *  （Build Variables の古い workers.dev bake-in で apex を壊さない）。
 * - `operation_mode = maintenance`（KV ミラー）または `MAINTENANCE_MODE=1` のとき、
 *   一般ユーザーは `/maintenance` に戻す。`/admin`・`/api/auth`・`/api/health` は通す。
 * - 厳密な権限判定はページ側 (`requireSession` / RSC) で行う。
 *
 * 公開 JSON の停止は `loadPublicJson` が operation_mode を先に判定する。
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

async function resolveConfiguredSiteOrigin(): Promise<string | undefined> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const env = getCloudflareContext().env as {
      NEXT_PUBLIC_SITE_URL?: string;
      AUTH_URL?: string;
    };
    const fromRuntime =
      env.NEXT_PUBLIC_SITE_URL?.trim() || env.AUTH_URL?.trim();
    if (fromRuntime) return fromRuntime;
  } catch {
    // fall through to process.env (local / build)
  }

  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.AUTH_URL?.trim()
  );
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const canonicalRedirect = resolveCanonicalHostRedirect({
    configuredOrigin: await resolveConfiguredSiteOrigin(),
    forwardedHost: req.headers.get("x-forwarded-host"),
    host: req.headers.get("host"),
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
  });
  if (canonicalRedirect) {
    return NextResponse.redirect(canonicalRedirect, 308);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  const search = req.nextUrl.searchParams.toString();
  if (search) requestHeaders.set("x-search", search);

  const passThrough = () =>
    NextResponse.next({ request: { headers: requestHeaders } });

  const isMaintenance = await resolveMiddlewareMaintenance();
  if (!isMaintenance) return passThrough();

  const url = req.nextUrl;
  if (
    url.pathname.startsWith("/maintenance") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/api/auth") ||
    url.pathname.startsWith("/api/health")
  ) {
    return passThrough();
  }

  return NextResponse.redirect(new URL("/maintenance", url));
}
