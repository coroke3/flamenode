export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { loadSlotViewerOverlay } from "@/lib/slots/slotViewerOverlay";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const eventId = id.trim().slice(0, 128);
  if (!eventId) {
    return NextResponse.json(
      { error: "invalid_event_id" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const overlay = await loadSlotViewerOverlay(eventId);
  if (!overlay) {
    return NextResponse.json(
      { error: "event_not_found" },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }
  return NextResponse.json(overlay, { headers: PRIVATE_HEADERS });
}
