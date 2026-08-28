import "server-only";

import { and, desc, eq } from "drizzle-orm";
import {
  CurrentUserUnavailableError,
  getCurrentUserContext,
} from "@/lib/auth/currentUser";
import {
  canEditVideo,
  resolveAdminOrEventVideoPrivilegeMode,
} from "@/lib/auth/ownership";
import { withDatabase } from "@/lib/cloudflare";
import {
  videoInteractionsAuth,
  videos as videosTable,
} from "@/lib/db/schema";
import { fetchAuthorizedPrivateVideoChapters } from "@/lib/db/videoDetailQueries";
import { fetchVideoRowByIdOrYoutube } from "@/lib/db/videoIdLookup";
import { loadPublicEventPlaylistR2Only } from "@/lib/publicData/r2EventPlaylist";
import { resolvePublicOperationMode } from "@/lib/operationMode/publicMode";
import { isLiveApiEnabled } from "@/lib/operationMode/policy";
import type {
  VideoViewerOverlayDto,
  VideoViewerOverlayPlaylistItem,
} from "./videoViewerOverlayCore";

function emptyOverlay(args?: {
  playlistLabel?: string;
  playlistItems?: VideoViewerOverlayPlaylistItem[];
}): VideoViewerOverlayDto {
  return {
    loggedIn: false,
    authUnavailable: false,
    isBanned: false,
    isTosAccepted: false,
    termsReacceptRequired: false,
    activeXId: null,
    likeActive: false,
    bookmarkActive: false,
    viewerXApproved: false,
    privateChapters: [],
    playlistLabel: args?.playlistLabel ?? "再生リスト",
    playlistItems: args?.playlistItems ?? [],
  };
}

async function loadStaticEventPlaylistOverlay(
  playlist: string,
  playlistEventTitle?: string | null,
): Promise<Pick<VideoViewerOverlayDto, "playlistLabel" | "playlistItems">> {
  if (!playlist || playlist === "lib-like" || playlist === "lib-bookmark") {
    return { playlistLabel: "再生リスト", playlistItems: [] };
  }
  const artifact = await loadPublicEventPlaylistR2Only(playlist);
  if (!artifact || artifact.items.length <= 1) {
    return { playlistLabel: "再生リスト", playlistItems: [] };
  }
  return {
    playlistLabel: `${playlistEventTitle ?? "イベント"} 上映順`,
    playlistItems: artifact.items.map((item) => ({
      id: item.id,
      title: item.title,
      youtube_video_id: item.youtube_video_id,
      display_name: item.display_name,
    })),
  };
}

/**
 * Public video SSRから切り離したviewer固有overlay。
 * 認可は全てserver-sideで行い、公開event playlistだけはR2 projectionを使う。
 */
export async function loadVideoViewerOverlay(args: {
  rawId: string;
  videoId: string;
  playlist: string;
  playlistEventTitle?: string | null;
}): Promise<VideoViewerOverlayDto> {
  const publicPlaylist = await loadStaticEventPlaylistOverlay(
    args.playlist,
    args.playlistEventTitle,
  );

  const operationMode = await resolvePublicOperationMode({ allowD1: false });
  if (!isLiveApiEnabled(operationMode)) {
    return emptyOverlay(publicPlaylist);
  }

  let context: Awaited<ReturnType<typeof getCurrentUserContext>>;
  try {
    context = await getCurrentUserContext();
  } catch (error) {
    if (error instanceof CurrentUserUnavailableError) {
      return {
        ...emptyOverlay(publicPlaylist),
        authUnavailable: true,
      };
    }
    throw error;
  }

  const viewer = context.user;
  if (!viewer) return emptyOverlay(publicPlaylist);

  const activeXId = viewer.active_x_user_id ?? null;
  const isBanned = viewer.is_banned === 1;
  if (isBanned) {
    return {
      ...emptyOverlay(publicPlaylist),
      loggedIn: true,
      isBanned: true,
      isTosAccepted: viewer.is_tos_accepted === 1,
      termsReacceptRequired: viewer.terms_reaccept_required === 1,
      activeXId,
    };
  }

  // getCurrentUserContext()が同一request内でDB正本から取得済みのlink行を再利用する。
  // getApprovedXIds()を再実行せず、認可境界ではapproval_statusを明示的に再確認する。
  const approvedXIds = context.linkedXUsers
    .filter((entry) => entry.approval_status === "approved")
    .map((entry) => entry.x_user_id);
  const viewerXApproved = Boolean(
    activeXId && approvedXIds.includes(activeXId),
  );

  try {
    const dbOverlay = await withDatabase(async (db) => {
      let viewerCanEditChapters = false;
      const probe = await fetchVideoRowByIdOrYoutube(db, args.rawId);
      if (probe) {
        viewerCanEditChapters = await canEditVideo({
          db,
          user: { id: viewer.id, role: viewer.role ?? null },
          video: probe,
          requiredKey: "video.chapter_admin",
          privilegeMode: resolveAdminOrEventVideoPrivilegeMode(viewer.role),
          approvedXUserIds: viewer.role === "admin" ? [] : approvedXIds,
        });
      }

      const privateChapters =
        viewerCanEditChapters || approvedXIds.length > 0
          ? await fetchAuthorizedPrivateVideoChapters(db, args.videoId, {
              id: viewer.id,
              role: viewer.role ?? null,
              approvedXIds,
              canEditChapters: viewerCanEditChapters,
            })
          : [];

      const interactions = await db
        .select({ interaction_type: videoInteractionsAuth.interaction_type })
        .from(videoInteractionsAuth)
        .where(
          and(
            eq(videoInteractionsAuth.auth_user_id, viewer.id),
            eq(videoInteractionsAuth.video_id, args.videoId),
          )!,
        );

      let privatePlaylist = publicPlaylist;
      if (args.playlist === "lib-like" || args.playlist === "lib-bookmark") {
        const kind = args.playlist === "lib-like" ? "like" : "bookmark";
        const rows = await db
          .select({
            id: videosTable.id,
            title: videosTable.title,
            youtube_video_id: videosTable.youtube_video_id,
            display_name: videosTable.creator_display_name,
          })
          .from(videoInteractionsAuth)
          .innerJoin(videosTable, eq(videosTable.id, videoInteractionsAuth.video_id))
          .where(
            and(
              eq(videoInteractionsAuth.auth_user_id, viewer.id),
              eq(videoInteractionsAuth.interaction_type, kind),
              eq(videosTable.visibility_status, "public"),
            )!,
          )
          .orderBy(desc(videosTable.scheduled_time));
        privatePlaylist = {
          playlistLabel:
            kind === "like" ? "いいねした作品" : "セーブした作品",
          playlistItems: rows.map((row) => ({
            id: row.id,
            title: row.title,
            youtube_video_id: row.youtube_video_id,
            display_name: row.display_name,
          })),
        };
      }

      return {
        likeActive: interactions.some(
          (interaction) => interaction.interaction_type === "like",
        ),
        bookmarkActive: interactions.some(
          (interaction) => interaction.interaction_type === "bookmark",
        ),
        privateChapters,
        ...privatePlaylist,
      };
    });

    if (!dbOverlay) {
      return {
        ...emptyOverlay(publicPlaylist),
        loggedIn: true,
        authUnavailable: true,
        isBanned: false,
        isTosAccepted: viewer.is_tos_accepted === 1,
        termsReacceptRequired: viewer.terms_reaccept_required === 1,
        activeXId,
        viewerXApproved,
      };
    }

    return {
      loggedIn: true,
      authUnavailable: false,
      isBanned: false,
      isTosAccepted: viewer.is_tos_accepted === 1,
      termsReacceptRequired: viewer.terms_reaccept_required === 1,
      activeXId,
      viewerXApproved,
      likeActive: dbOverlay.likeActive,
      bookmarkActive: dbOverlay.bookmarkActive,
      privateChapters: dbOverlay.privateChapters,
      playlistLabel: dbOverlay.playlistLabel,
      playlistItems: dbOverlay.playlistItems,
    };
  } catch {
    return {
      ...emptyOverlay(publicPlaylist),
      loggedIn: true,
      authUnavailable: true,
      isBanned: false,
      isTosAccepted: viewer.is_tos_accepted === 1,
      termsReacceptRequired: viewer.terms_reaccept_required === 1,
      activeXId,
      viewerXApproved,
    };
  }
}
