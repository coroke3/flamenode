export const runtime = "edge";

import { NextResponse } from "next/server";

/**
 * この API は廃止されました。
 * 新しいエンドポイント: /api/admin/import/legacy
 */
export async function POST(): Promise<Response> {
  return NextResponse.json(
    {
      error: "gone",
      message:
        "このエンドポイントは廃止されました。/api/admin/import/legacy を使用してください。",
      newEndpoint: "/api/admin/import/legacy",
    },
    { status: 410 },
  );
}

export async function GET(): Promise<Response> {
  return NextResponse.json(
    {
      error: "gone",
      message:
        "このエンドポイントは廃止されました。/api/admin/import/legacy を使用してください。",
      newEndpoint: "/api/admin/import/legacy",
    },
    { status: 410 },
  );
}
