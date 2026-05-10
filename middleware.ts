import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: コストガード / メンテナンスモードの粗い制御。
 *
 * - `cost_guard_mode = maintenance` または `is_maintenance_mode = 1` のとき、
 *   一般ユーザーは `/maintenance` に戻す。`/admin` と `/api/auth` 系は通す。
 * - 厳密な権限判定はページ側 (`requireSession` / RSC) で行う。Edge では DB を引かない。
 *
 * 実際のフラグは Cloudflare KV (`KV.system_settings:cost_guard_mode`) で参照する想定。
 * 開発環境では KV が無いので環境変数 `MAINTENANCE_MODE=1` でフォールバックする。
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|maintenance|api/auth|admin).*)",
  ],
};

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const isMaintenance = process.env.MAINTENANCE_MODE === "1";
  if (!isMaintenance) return NextResponse.next();

  // 既にメンテナンスページや認証 API ならそのまま
  const url = req.nextUrl;
  if (
    url.pathname.startsWith("/maintenance") ||
    url.pathname.startsWith("/admin") ||
    url.pathname.startsWith("/api/auth")
  ) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/maintenance", url));
}
