import React from "react";
import { formatChapterTime } from "../../../../packages/domain/src/video/chapterTime.ts";
import { seekToTime } from "../../../../src/components/video/playerBridge.ts";
import type { VideoViewerOverlayDto } from "../../../../packages/contracts/src/videoViewerOverlay.ts";
import { VideoChapterIsland, type EditableChapter } from "./VideoChapterIsland.ts";

const h = React.createElement;
const AUTO_NEXT_KEY = "fn-playlist-autonext";
const ORDER_KEY_PREFIX = "fn-playlist-order:";

export interface PublicVideoChapter {
  id: string;
  timeLabel: string;
  label: string;
  authorName?: string | null;
  kind?: "member" | "comment";
}
export interface VideoUtilityDockIslandProps {
  videoId: string;
  currentId: string;
  publicChapters: readonly PublicVideoChapter[];
  overlay: VideoViewerOverlayDto;
  loading: boolean;
  /** The mount caller must authorize bulk from the actual operator permission, not active X alone. */
  canBulk?: boolean;
  editableChapters?: readonly EditableChapter[];
  onRefresh?: () => void;
}

export function resolvePlaylistQuery(search: string): string {
  try { return (new URLSearchParams(search).get("playlist") ?? "").trim().slice(0, 128); }
  catch { return ""; }
}
export function playlistItemHref(item: { id: string; youtube_video_id?: string | null }, playlist: string): string {
  const slug = item.youtube_video_id?.trim() || item.id;
  return `/${encodeURIComponent(slug)}${playlist ? `?playlist=${encodeURIComponent(playlist)}` : ""}`;
}
export function canPostVideoChapter(overlay: VideoViewerOverlayDto, loading: boolean): boolean {
  return !loading && overlay.loggedIn && overlay.viewerXApproved && Boolean(overlay.activeXId) &&
    !overlay.isBanned && overlay.isTosAccepted && !overlay.termsReacceptRequired &&
    !overlay.authUnavailable;
}
export function chapterRowsForViewer(
  publicChapters: readonly PublicVideoChapter[],
  overlay: VideoViewerOverlayDto,
): PublicVideoChapter[] {
  const publicIds = new Set(publicChapters.map((item) => item.id));
  const privateRows = overlay.privateChapters
    .filter((item) => !publicIds.has(item.id))
    .map((item) => ({
      id: item.id,
      timeLabel: formatChapterTime(item.chapter_time),
      label: item.chapter_label,
      authorName: item.author_name,
      kind: "comment" as const,
    }));
  return [...publicChapters, ...privateRows].sort((a, b) => {
    const time = (s: string) => s.split(":").map(Number).reduce((v, n) => v * 60 + n, 0);
    return time(a.timeLabel) - time(b.timeLabel);
  });
}
function uniquePlaylistItems(items: VideoViewerOverlayDto["playlistItems"]) {
  return items.filter((item, i) => items.findIndex((other) => other.id === item.id) === i);
}

/** U03: no Next import, private viewer state is injected by the eventual U01 owner. */
export function VideoUtilityDockIsland({
  videoId, currentId, publicChapters, overlay, loading,
  canBulk = false, editableChapters = [], onRefresh,
}: VideoUtilityDockIslandProps): React.ReactElement | null {
  const [mounted, setMounted] = React.useState(false);
  const [playlist, setPlaylist] = React.useState("");
  const [panel, setPanel] = React.useState<"playlist" | "chapters" | null>(null);
  const [autoNext, setAutoNext] = React.useState(false);
  const [order, setOrder] = React.useState<string[]>([]);
  const [ready, setReady] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => { setMounted(true); }, []);
  React.useEffect(() => {
    const media = window.matchMedia?.("(max-width: 900px)");
    if (!media) return;
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  React.useEffect(() => {
    if (!mounted) return;
    setPlaylist(resolvePlaylistQuery(window.location.search));
  }, [mounted, videoId, currentId]);
  React.useEffect(() => {
    if (!mounted) return;
    try { setAutoNext(localStorage.getItem(AUTO_NEXT_KEY) === "1"); } catch { /* disabled */ }
  }, [mounted]);
  React.useEffect(() => {
    if (!mounted) return;
    try {
      const data = playlist ? JSON.parse(localStorage.getItem(ORDER_KEY_PREFIX + playlist) ?? "[]") as unknown : [];
      setOrder(Array.isArray(data) ? data.filter((x): x is string => typeof x === "string") : []);
    } catch { setOrder([]); }
    setReady(true);
  }, [mounted, playlist]);
  React.useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(AUTO_NEXT_KEY, autoNext ? "1" : "0"); } catch { /* disabled */ }
  }, [autoNext, ready]);
  React.useEffect(() => {
    if (!ready || !playlist) return;
    try { localStorage.setItem(ORDER_KEY_PREFIX + playlist, JSON.stringify(order)); } catch { /* disabled */ }
  }, [order, ready, playlist]);

  const items = React.useMemo(() => {
    const unique = uniquePlaylistItems(overlay.playlistItems);
    const byId = new Map<string, (typeof unique)[number]>(unique.map((item) => [item.id, item] as const));
    const ordered = order.map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => Boolean(i));
    const used = new Set(ordered.map((item) => item.id));
    return [...ordered, ...unique.filter((item) => !used.has(item.id))];
  }, [overlay.playlistItems, order]);
  const index = items.findIndex((item) => currentId === item.id || currentId === item.youtube_video_id);
  const previous = index > 0 ? items[index - 1] : null;
  const next = index >= 0 && index + 1 < items.length ? items[index + 1] : null;
  const chapters = React.useMemo(
    () => chapterRowsForViewer(publicChapters, overlay),
    [publicChapters, overlay],
  );
  React.useEffect(() => {
    if (!mounted || !autoNext || !next) return;
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ youtubeId?: string }>).detail?.youtubeId;
      if (id !== currentId && id !== items[index]?.youtube_video_id) return;
      window.location.assign(playlistItemHref(next, playlist));
    };
    window.addEventListener("flamenode:video-ended", handler);
    return () => window.removeEventListener("flamenode:video-ended", handler);
  }, [mounted, autoNext, next, currentId, items, index, playlist]);
  React.useEffect(() => {
    if (!mounted || !panel) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPanel(null); };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [mounted, panel]);

  // Never put viewer-specific playlist data, author names, or write controls in SSG HTML.
  if (!mounted) return null;
  const canPost = canPostVideoChapter(overlay, loading);
  const href = (item: NonNullable<typeof next>) => playlistItemHref(item, playlist);
  return h("aside", { className: "fn-video-utility-dock", "aria-label": "動画補助機能" },
    h("nav", { role: "group", "aria-label": "動画補助メニュー" },
      h("button", {
        type: "button", "aria-expanded": panel === "playlist",
        "aria-controls": "video-utility-playlist", disabled: items.length === 0,
        onClick: () => setPanel(panel === "playlist" ? null : "playlist"),
      }, `再生リスト (${items.length})`),
      h("button", {
        type: "button", "aria-expanded": panel === "chapters",
        "aria-controls": "video-utility-chapters",
        onClick: () => setPanel(panel === "chapters" ? null : "chapters"),
      }, `チャプター (${chapters.length})`),
    ),
    panel !== null ? h("button", { type: "button", onClick: () => setPanel(null), "aria-label": "パネルを閉じる" }, "閉じる") : null,
    h("section", { id: "video-utility-playlist", hidden: isMobile && panel !== "playlist", "aria-label": "再生リスト" },
      items.length > 0 ? h(React.Fragment, null,
        h("h3", null, overlay.playlistLabel || "再生リスト"),
        h("p", null, index >= 0 ? `${index + 1} / ${items.length}` : `${items.length} 本`),
        previous ? h("a", { href: href(previous) }, "前へ") : null,
        next ? h("a", { href: href(next) }, "次へ") : null,
        h("label", null, h("input", { type: "checkbox", checked: autoNext, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setAutoNext(e.target.checked) }), "次の動画を自動再生"),
        h("button", { type: "button", disabled: order.length === 0, onClick: () => setOrder([]) }, "並び順を初期化"),
        h("ol", null, ...items.map((item, pos) =>
          h("li", { key: item.id },
            h("a", { href: href(item), "aria-current": pos === index ? "page" : undefined }, item.title),
            h("button", { type: "button", disabled: pos === 0, "aria-label": `${item.title}を上へ`, onClick: () => setOrder((_) => {
              const ids = items.map((i) => i.id);
              [ids[pos - 1], ids[pos]] = [ids[pos]!, ids[pos - 1]!];
              return ids;
            }) }, "↑"),
            h("button", { type: "button", disabled: pos === items.length - 1, "aria-label": `${item.title}を下へ`, onClick: () => setOrder((_) => {
              const ids = items.map((i) => i.id);
              [ids[pos + 1], ids[pos]] = [ids[pos]!, ids[pos + 1]!];
              return ids;
            }) }, "↓"),
          ),
        )),
      ) : null,
    ),
    h("section", { id: "video-utility-chapters", hidden: isMobile && panel !== "chapters", "aria-label": "チャプター・コメント" },
      h("h3", null, "チャプター・コメント"),
      chapters.length === 0 ? h("p", null, "チャプターはまだありません。") :
        h("ol", null, ...chapters.map((chapter) =>
          h("li", { key: chapter.id },
            h("button", { type: "button", "aria-label": `${chapter.timeLabel}に移動`, onClick: () => {
              const seconds = chapter.timeLabel.split(":").map(Number).reduce((v, n) => v * 60 + n, 0);
              seekToTime(seconds);
            } }, chapter.timeLabel),
            " ", chapter.label, chapter.authorName ? ` · ${chapter.authorName}` : ""),
        )),
      h(VideoChapterIsland, {
        videoId, activeXId: overlay.activeXId, canPost,
        canBulk: canPost && canBulk, chapters: editableChapters,
        onChanged: onRefresh,
      }),
    ),
  );
}
export default VideoUtilityDockIsland;
