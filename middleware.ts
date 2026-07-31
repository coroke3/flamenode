import { NextResponse, type NextRequest } from "next/server";
import { resolveMiddlewareMaintenance } from "@/lib/operationMode/middlewareMaintenance";

/**
 * Edge middleware: コストガード / メンテナンスモードの粗い制御。
 *
 * - `operation_mode = maintenance`（KV ミラー）または `MAINTENANCE_MODE=1` のとき、
 *   一般ユーザーは `/maintenance` に戻す。`/admin`・`/api/auth`・`/api/health` は通す。
 * - 厳密な権限判定はページ側 (`requireSession` / RSC) で行う。
 *
 * 公開 JSON の停止は `loadPublicJson` が operation_mode を先に判定する。
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|maintenance|api/auth|api/health|admin).*)",
  ],
};

export async function middleware(req: NextRequest): Promise<NextResponse> {
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
