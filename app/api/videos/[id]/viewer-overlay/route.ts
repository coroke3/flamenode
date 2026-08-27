export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { loadStaticVideoDetail } from "@/lib/publicData/loader";
import { loadVideoViewerOverlay } from "@/lib/video/videoViewerOverlay";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const rawId = id.trim().slice(0, 128);
  if (!rawId) {
    return NextResponse.json(
      { error: "invalid_video_id" },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const detail = await loadStaticVideoDetail(rawId);
  if (!detail.data || detail.data.video.visibility_status !== "public") {
    return NextResponse.json(
      { error: "video_not_found" },
      { status: 404, headers: PRIVATE_HEADERS },
    );
  }

  const url = new URL(request.url);
  const playlist = (url.searchParams.get("playlist") ?? "").trim().slice(0, 128);
  const playlistEventTitle = playlist
    ? detail.data.publicEvents.find((event) => event.id === playlist)?.title ?? null
    : null;

  const overlay = await loadVideoViewerOverlay({
    rawId,
    videoId: detail.data.video.id,
    playlist,
    playlistEventTitle,
  });

  return NextResponse.json(overlay, { headers: PRIVATE_HEADERS });
}
