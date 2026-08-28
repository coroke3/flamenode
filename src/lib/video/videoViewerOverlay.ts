import "server-only";

import { and, asc, desc, eq, notLike, sql } from "drizzle-orm";
import {
  CurrentUserUnavailableError,
  getCurrentUserContext,
} from "@/lib/auth/currentUser";
import {
  canEditVideo,
  resolveAdminOrEventVideoPrivilegeMode,
} from "@/lib/auth/ownership";
import { withDatabase } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import {
  videoChapters,
  videoInteractionsAuth,
  videos as videosTable,
  xUsers,
} from "@/lib/db/schema";
import { fetchVideoRowByIdOrYoutube } from "@/lib/db/videoIdLookup";
import { loadPublicEventPlaylistR2Only } from "@/lib/publicData/r2EventPlaylist";
import { EVENT_PLAYLIST_MAX_ITEMS } from "@/lib/publicData/staticEventPlaylistCore";
import { resolvePublicOperationMode } from "@/lib/operationMode/publicMode";
import { isLiveApiEnabled } from "@/lib/operationMode/policy";
import {
  VIDEO_VIEWER_OVERLAY_MAX_PRIVATE_CHAPTERS,
  type VideoViewerOverlayDto,
  type VideoViewerOverlayPlaylistItem,
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

/**
 * viewer overlay専用のprivate chapter read。
 * 旧helperと同じ認可条件を保ちつつ、clientが受理する最大件数でD1 query自体を止める。
 * 全件取得後のsliceではWorkers CPU/JSON化コストを削減できないためserver側でboundedにする。
 */
async function fetchBoundedPrivateChapters(
  db: DB,
  videoId: string,
  viewer: {
    role: string | null;
    approvedXIds: string[];
    canEditChapters: boolean;
  },
): Promise<VideoViewerOverlayDto["privateChapters"]> {
  const canSeeAllPrivate =
    viewer.role === "admin" || viewer.canEditChapters === true;
  if (!canSeeAllPrivate && viewer.approvedXIds.length === 0) return [];

  const ownerCondition = canSeeAllPrivate
    ? eq(videoChapters.visibility, "private")
    : and(
        eq(videoChapters.visibility, "private"),
        sql`${videoChapters.x_user_id} IN (
          SELECT CAST(value AS TEXT)
          FROM json_each(${JSON.stringify(viewer.approvedXIds)})
        )`,
        // linked X read後にapprovalが変化しても同じstatementでfail-closed。
        eq(xUsers.approval_status, "approved"),
      )!;

  return db
    .select({
      id: videoChapters.id,
      chapter_time: videoChapters.chapter_time,
      chapter_label: videoChapters.chapter_label,
      visibility: sql<"private">`'private'`,
      note: videoChapters.note,
      author_name: xUsers.x_name,
      author_icon: xUsers.icon_url,
    })
    .from(videoChapters)
    .leftJoin(xUsers, eq(xUsers.id, videoChapters.x_user_id))
    .where(
      and(
        eq(videoChapters.video_id, videoId),
        ownerCondition,
        notLike(videoChapters.id, "%:member:%"),
        notLike(videoChapters.id, "%:legacy:%"),
      )!,
    )
    .orderBy(asc(videoChapters.chapter_time), asc(videoChapters.id))
    .limit(VIDEO_VIEWER_OVERLAY_MAX_PRIVATE_CHAPTERS);
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
      // static artifactとD1のID解決が一時的にずれた場合、別動画の編集権限を
      // 現在表示中のvideoIdへ転用しない。stale artifact / YouTube ID変更raceは
      // 権限なしとしてfail-closedし、次のrebuild後に自然復旧させる。
      if (probe?.id === args.videoId) {
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
          ? await fetchBoundedPrivateChapters(db, args.videoId, {
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
          .orderBy(desc(videosTable.scheduled_time))
          // client側も同じ最大件数しか表示しない。serverで全件SELECTしてから
          // truncateすると長期利用ユーザーほどD1/JSON CPUが増えるため、query自体をboundedにする。
          .limit(EVENT_PLAYLIST_MAX_ITEMS);
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
