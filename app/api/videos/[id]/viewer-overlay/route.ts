export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { loadStaticVideoDetail } from "@/lib/publicData/loader";
import { loadVideoViewerOverlay } from "@/lib/video/videoViewerOverlay";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;
const UNAVAILABLE_HEADERS = {
  ...PRIVATE_HEADERS,
  "Retry-After": "3",
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

  try {
    const detail = await loadStaticVideoDetail(rawId);
    if (!detail.data) {
      const unavailable =
        detail.state === "unavailable" ||
        detail.state === "reflecting" ||
        detail.state === "stale";
      return NextResponse.json(
        { error: unavailable ? "viewer_overlay_unavailable" : "video_not_found" },
        {
          status: unavailable ? 503 : 404,
          headers: unavailable ? UNAVAILABLE_HEADERS : PRIVATE_HEADERS,
        },
      );
    }
    if (detail.data.video.visibility_status !== "public") {
      return NextResponse.json(
        { error: "video_not_found" },
        { status: 404, headers: PRIVATE_HEADERS },
      );
    }

    const url = new URL(request.url);
    const playlist = (url.searchParams.get("playlist") ?? "")
      .trim()
      .slice(0, 128);
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
  } catch (error) {
    console.error("[video-viewer-overlay] request failed", {
      rawId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json(
      { error: "viewer_overlay_unavailable" },
      { status: 503, headers: UNAVAILABLE_HEADERS },
    );
  }
}
