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

// isolateを跨いで保持してよいのは解決済みのpure stringだけにする。
// request contextを参照するPromiseは別requestからawaitしない。
let configuredSiteOrigin: string | undefined;

async function loadConfiguredSiteOrigin(): Promise<string | undefined> {
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

async function resolveConfiguredSiteOrigin(): Promise<string | undefined> {
  if (configuredSiteOrigin) return configuredSiteOrigin;
  const value = await loadConfiguredSiteOrigin();
  // 正常に得られた設定だけをisolate内で保持する。初回context取得失敗や
  // 一時的な未設定(undefined)を永続cacheすると、そのisolateだけcanonical
  // redirectが以後ずっと無効になるため、undefinedは次requestで再試行する。
  if (value) configuredSiteOrigin = value;
  return value;
}

function matchesPathSegmentPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
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

  const isMaintenance = await resolveMiddlewareMaintenance();
  if (!isMaintenance) return NextResponse.next();

  const url = req.nextUrl;
  if (
    matchesPathSegmentPrefix(url.pathname, "/maintenance") ||
    matchesPathSegmentPrefix(url.pathname, "/admin") ||
    matchesPathSegmentPrefix(url.pathname, "/api/auth") ||
    matchesPathSegmentPrefix(url.pathname, "/api/health")
  ) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/maintenance", url));
}
