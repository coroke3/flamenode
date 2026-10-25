import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";
import { sessionMiddleware } from "../../auth/session.ts";
import { loadPublicSnapshot } from "../../lib/publicSnapshot.ts";
import { isLiveApiEnabled, resolvePublicOperationMode } from "../live/operationMode.ts";
import { normalizeStaticVideoDetail } from "@flamenode/server-core/publicData/videoDetailCore";
import {
  EVENT_PLAYLIST_MAX_OBJECT_BYTES,
  eventPlaylistObjectKey,
  normalizeStaticEventPlaylist,
} from "@flamenode/server-core/publicData/eventPlaylistCore";
import {
  canAdministerChapters,
  parseAccessFacts,
} from "./chapterAccess.ts";
import {
  TERMS_REACCEPT_REQUIRED_CASE_SQL,
  TERMS_REACCEPT_REQUIRED_CTE_SQL,
} from "../personal/context.ts";
import { resolveActiveXUserId } from "../account/summary.ts";
import type {
  VideoViewerOverlayDto,
  VideoViewerOverlayPlaylistItem,
} from "@flamenode/contracts";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

/** CURRENT src/lib/publicData/r2EventPlaylist.ts readVisibleEventArtifact: other ids are never read. */
const PLAYLIST_EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const UNAVAILABLE_HEADERS = {
  ...PRIVATE_HEADERS,
  "Retry-After": "3",
} as const;

function parseJsonArray<T = string>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      return [];
    }
  }
  return [];
}

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
  bucket: R2Bucket | undefined,
  guardModeRaw: string | undefined,
  playlist: string,
  playlistEventTitle?: string | null,
): Promise<Pick<VideoViewerOverlayDto, "playlistLabel" | "playlistItems">> {
  if (!playlist || playlist === "lib-like" || playlist === "lib-bookmark") {
    return { playlistLabel: "再生リスト", playlistItems: [] };
  }
  if (!PLAYLIST_EVENT_ID_PATTERN.test(playlist)) {
    return { playlistLabel: "再生リスト", playlistItems: [] };
  }
  const snapshot = await loadPublicSnapshot({
    bucket,
    key: eventPlaylistObjectKey(playlist),
    targetType: "event_slots",
    guardModeRaw,
    targetEntityId: playlist,
    maxBytes: EVENT_PLAYLIST_MAX_OBJECT_BYTES,
  });
  if (snapshot.kind !== "ok" || !snapshot.data) {
    return { playlistLabel: "再生リスト", playlistItems: [] };
  }
  const artifact = normalizeStaticEventPlaylist(snapshot.data as any, playlist);
  if (!artifact || !artifact.complete || artifact.items.length <= 1) {
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

export function createVideoViewerOverlayRoutes(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  // Work Order U03 order: artifact gate -> operation mode -> session. The session lookup (1 D1
  // statement) runs only once the video is known public, so 404 / 503 / static-mode answers read no D1.
  const resolveSession = (options.session ??
    (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>));

  routes.get("/:id/viewer-overlay", async (c) => {
    const id = c.req.param("id");
    const rawId = (id ?? "").trim().slice(0, 128);
    if (!rawId) {
      return c.json({ error: "invalid_video_id" }, 400, PRIVATE_HEADERS);
    }

    let snapshot;
    try {
      snapshot = await loadPublicSnapshot({
        bucket: c.env.BUCKET,
        key: `videos/${rawId}.json`,
        targetType: "video",
        guardModeRaw: c.env.PUBLIC_VISIBILITY_GUARD_MODE,
        targetEntityId: rawId,
      });
    } catch (error) {
      console.error("[video-viewer-overlay] snapshot read error", { rawId, error });
      return c.json({ error: "viewer_overlay_unavailable" }, 503, UNAVAILABLE_HEADERS);
    }

    if (snapshot.kind === "unavailable") {
      return c.json({ error: "viewer_overlay_unavailable" }, 503, UNAVAILABLE_HEADERS);
    }
    if (snapshot.kind === "not_found" || !snapshot.data) {
      return c.json({ error: "video_not_found" }, 404, PRIVATE_HEADERS);
    }

    const detail = normalizeStaticVideoDetail(snapshot.data as any);
    if (!detail || detail.video.visibility_status !== "public") {
      return c.json({ error: "video_not_found" }, 404, PRIVATE_HEADERS);
    }

    const playlist = (c.req.query("playlist") ?? "").trim().slice(0, 128);
    const playlistEventTitle = playlist
      ? detail.publicEvents.find((event) => event.id === playlist)?.title ?? null
      : null;

    const publicPlaylist = await loadStaticEventPlaylistOverlay(
      c.env.BUCKET,
      c.env.PUBLIC_VISIBILITY_GUARD_MODE,
      playlist,
      playlistEventTitle,
    );

    const operationMode = await resolvePublicOperationMode(c.env, { allowD1: false });
    if (!isLiveApiEnabled(operationMode)) {
      return c.json(emptyOverlay(publicPlaylist), 200, PRIVATE_HEADERS);
    }

    await resolveSession(c, async () => {});
    if (c.get("sessionState") === "unavailable") {
      return c.json(
        {
          ...emptyOverlay(publicPlaylist),
          authUnavailable: true,
        },
        200,
        PRIVATE_HEADERS,
      );
    }

    const viewer = c.get("user");
    if (!viewer) {
      return c.json(emptyOverlay(publicPlaylist), 200, PRIVATE_HEADERS);
    }

    // CURRENT getCurrentUserContext: the user row (terms) and the approved linked X ids are read for
    // every signed-in viewer, banned included; a failed read is "auth unavailable" (signed out shape).
    const authUnavailable = () =>
      c.json({ ...emptyOverlay(publicPlaylist), authUnavailable: true }, 200, PRIVATE_HEADERS);
    if (!c.env.DB) return authUnavailable();

    let degraded: Pick<
      VideoViewerOverlayDto,
      "isTosAccepted" | "termsReacceptRequired" | "activeXId" | "viewerXApproved"
    > | null = null;
    try {
      // Statement 1: video + correlated permission facts + user TOS & linked X facts
      const stmt1Sql = `${TERMS_REACCEPT_REQUIRED_CTE_SQL}
SELECT 
  (SELECT json_object(
      'id', v."id",
      'primary_event_id', v."primary_event_id",
      'visibility_status', v."visibility_status",
      've_json', (SELECT coalesce(json_group_array(ve."event_id"), '[]') FROM (SELECT "event_id" FROM "video_events" WHERE "video_id" = v."id" ORDER BY "event_id" LIMIT 4) ve),
      'staff_json', (SELECT coalesce(json_group_array(json_object('event_id', s."event_id", 'permission_preset', s."permission_preset", 'custom_permission_keys_json', s."custom_permission_keys_json")), '[]')
                       FROM (SELECT es."event_id", es."permission_preset", es."custom_permission_keys_json" FROM "event_staff" es
                              WHERE es."x_user_id" IN (
                                SELECT x."id" FROM "x_user_account_links" l
                                INNER JOIN "x_users" x ON x."id" = l."x_user_id"
                                WHERE l."auth_user_id" = ? AND x."approval_status" = 'approved'
                              )
                                AND (es."event_id" = v."primary_event_id" OR es."event_id" IN (SELECT "event_id" FROM "video_events" WHERE "video_id" = v."id" LIMIT 4))
                              LIMIT 100) s)
   )
   FROM "videos" v
   WHERE v."id" = ? OR v."youtube_video_id" = ?
   LIMIT 1) AS video_json,
  (SELECT json_object(
      'is_tos_accepted', u."is_tos_accepted",
      'terms_reaccept_required', ${TERMS_REACCEPT_REQUIRED_CASE_SQL},
      'active_x_id', u."active_x_user_id",
      'approved_x_ids', (SELECT coalesce(json_group_array(x."id"), '[]') FROM "x_user_account_links" l INNER JOIN "x_users" x ON x."id" = l."x_user_id" WHERE l."auth_user_id" = u."id" AND x."approval_status" = 'approved')
   )
   FROM "user" u
   WHERE u."id" = ?
   LIMIT 1) AS user_json`;

      let row1: { video_json: string | null; user_json: string | null } | null;
      try {
        row1 = await c.env.DB.prepare(stmt1Sql)
          .bind(viewer.id, rawId, rawId, viewer.id)
          .first<{ video_json: string | null; user_json: string | null }>();
      } catch (error) {
        console.error("[video-viewer-overlay] viewer read failed", { rawId, error });
        return authUnavailable();
      }
      // CURRENT: a session whose user row is gone is signed out.
      if (!row1?.user_json) return c.json(emptyOverlay(publicPlaylist), 200, PRIVATE_HEADERS);

      const userData = JSON.parse(row1.user_json) as Record<string, unknown>;
      const isTosAccepted = userData.is_tos_accepted === 1;
      const termsReacceptRequired = userData.terms_reaccept_required === 1;
      const rawActiveX = typeof userData.active_x_id === "string" ? userData.active_x_id : null;
      const approvedXIds = parseJsonArray<string>(userData.approved_x_ids);
      // CURRENT resolveActiveXUserId: the D1 spelling of the matching approved X id, else the only
      // approved X id, else null; viewerXApproved is approvedXIds.includes(activeXId).
      const activeXId = resolveActiveXUserId(
        rawActiveX,
        approvedXIds.map((x_user_id) => ({ x_user_id, approval_status: "approved" })),
      );
      const viewerXApproved = Boolean(activeXId && approvedXIds.includes(activeXId));

      if (viewer.is_banned === 1) {
        return c.json(
          {
            ...emptyOverlay(publicPlaylist),
            loggedIn: true,
            isBanned: true,
            isTosAccepted,
            termsReacceptRequired,
            activeXId,
          },
          200,
          PRIVATE_HEADERS,
        );
      }
      degraded = { isTosAccepted, termsReacceptRequired, activeXId, viewerXApproved };

      let viewerCanEditChapters = false;
      if (row1.video_json) {
        const videoData = JSON.parse(row1.video_json) as {
          id: string;
          primary_event_id: string | null;
          ve_json: unknown;
          staff_json: unknown;
        };
        if (videoData.id === detail.video.id) {
          viewerCanEditChapters = canAdministerChapters(viewer.role, approvedXIds, {
            primary_event_id: videoData.primary_event_id,
            access: parseAccessFacts(videoData.ve_json, videoData.staff_json),
          });
        }
      }

      const canSeeAllPrivate = viewer.role === "admin" || viewerCanEditChapters;
      const canSeeAnyPrivate = canSeeAllPrivate || approvedXIds.length > 0;
      const isLibPlaylist = playlist === "lib-like" || playlist === "lib-bookmark";
      const libKind = playlist === "lib-like" ? "like" : "bookmark";

      // Statement 2: private chapters + interactions + lib playlist
      const chaptersSubquery = canSeeAnyPrivate
        ? `(SELECT coalesce(json_group_array(json_object(
              'id', c."id",
              'chapter_time', c."chapter_time",
              'chapter_label', c."chapter_label",
              'visibility', 'private',
              'note', c."note",
              'author_name', c."author_name",
              'author_icon', c."author_icon"
           )), '[]')
           FROM (
             SELECT ch."id", ch."chapter_time", ch."chapter_label", ch."note", u."x_name" AS "author_name", u."icon_url" AS "author_icon"
               FROM "video_chapters" ch
               LEFT JOIN "x_users" u ON u."id" = ch."x_user_id"
              WHERE ch."video_id" = ?
                AND ch."visibility" = 'private'
                AND (${canSeeAllPrivate ? "1=1" : `ch."x_user_id" IN (SELECT CAST(value AS TEXT) FROM json_each(?) WHERE value IS NOT NULL) AND u."approval_status" = 'approved'`})
                AND ch."id" NOT LIKE '%:member:%'
                AND ch."id" NOT LIKE '%:legacy:%'
              ORDER BY ch."chapter_time" ASC, ch."id" ASC
              LIMIT 500
           ) c) AS chapters_json`
        : `'[]' AS chapters_json`;

      const libPlaylistSubquery = isLibPlaylist
        ? `, (SELECT coalesce(json_group_array(json_object(
              'id', p."id",
              'title', p."title",
              'youtube_video_id', p."youtube_video_id",
              'display_name', p."display_name"
           )), '[]') FROM (
             SELECT v."id", v."title", v."youtube_video_id", v."creator_display_name" AS "display_name"
               FROM "video_interactions_auth" i
               INNER JOIN "videos" v ON v."id" = i."video_id"
              WHERE i."auth_user_id" = ?
                AND i."interaction_type" = ?
                AND v."visibility_status" = 'public'
              ORDER BY v."scheduled_time" DESC
              LIMIT 500
           ) p) AS lib_playlist_json`
        : "";

      const stmt2Sql = `SELECT 
        ${chaptersSubquery},
        (SELECT coalesce(json_group_array("interaction_type"), '[]')
           FROM (
             SELECT "interaction_type"
               FROM "video_interactions_auth"
              WHERE "auth_user_id" = ?
                AND "video_id" = ?
                AND "interaction_type" IN ('like', 'bookmark')
              GROUP BY "interaction_type"
              LIMIT 2
           )) AS interactions_json
        ${libPlaylistSubquery}`;

      const stmt2Binds: unknown[] = [];
      if (canSeeAnyPrivate) {
        stmt2Binds.push(detail.video.id);
        if (!canSeeAllPrivate) {
          stmt2Binds.push(JSON.stringify(approvedXIds));
        }
      }
      stmt2Binds.push(viewer.id, detail.video.id);
      if (isLibPlaylist) {
        stmt2Binds.push(viewer.id, libKind);
      }

      const row2 = await c.env.DB.prepare(stmt2Sql)
        .bind(...stmt2Binds)
        .first<{
          chapters_json: string | null;
          interactions_json: string | null;
          lib_playlist_json?: string | null;
        }>();

      const privateChapters = parseJsonArray<VideoViewerOverlayDto["privateChapters"][number]>(
        row2?.chapters_json,
      );
      const interactions = parseJsonArray<string>(row2?.interactions_json);
      const likeActive = interactions.includes("like");
      const bookmarkActive = interactions.includes("bookmark");

      let finalPlaylist = publicPlaylist;
      if (isLibPlaylist && row2?.lib_playlist_json) {
        const libItems = parseJsonArray<VideoViewerOverlayPlaylistItem>(row2.lib_playlist_json);
        finalPlaylist = {
          playlistLabel: libKind === "like" ? "いいねした作品" : "セーブした作品",
          playlistItems: libItems,
        };
      }

      const result: VideoViewerOverlayDto = {
        loggedIn: true,
        authUnavailable: false,
        isBanned: false,
        isTosAccepted,
        termsReacceptRequired,
        activeXId,
        likeActive,
        bookmarkActive,
        viewerXApproved,
        privateChapters,
        ...finalPlaylist,
      };

      return c.json(result, 200, PRIVATE_HEADERS);
    } catch (error) {
      console.error("[video-viewer-overlay] db read failed", { rawId, error });
      if (!degraded) return authUnavailable();
      // CURRENT: the viewer is known, the overlay read failed.
      return c.json(
        {
          ...emptyOverlay(publicPlaylist),
          loggedIn: true,
          authUnavailable: true,
          ...degraded,
        },
        200,
        PRIVATE_HEADERS,
      );
    }
  });

  return routes;
}

export const videoViewerOverlayRoutes = createVideoViewerOverlayRoutes();
