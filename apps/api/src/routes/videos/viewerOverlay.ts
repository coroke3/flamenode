import { Hono, type Context, type MiddlewareHandler } from "hono";
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
/** ZERO_1102 S2: public chapter full notes are read only when one row is explicitly requested. */
/** ZERO_1102 S2: response cap; never truncate a stored note in an editor DTO. */
const MAX_VIEWER_OVERLAY_RESPONSE_BYTES = 64 * 1024;

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
    viewerCanEditChapters: false,
    privateChapters: [],
    editablePublicChapters: [],
    playlistLabel: args?.playlistLabel ?? "再生リスト",
    playlistItems: args?.playlistItems ?? [],
  };
}


/**
 * Issue #709: every successful/degraded RH-031 response, including early
 * static-only and unauthenticated returns, must honor the UTF-8 S2 ceiling.
 * The playlist and one-row editor projection are optional; private chapters
 * and permission facts are not. Never truncate a PUT-ready chapter note.
 */
function boundedOverlayResponse(c: Context<AppEnv>, body: VideoViewerOverlayDto): Response {
  const encode = (dto: VideoViewerOverlayDto) => JSON.stringify(dto);
  // Every UTF-16 code unit needs at least one UTF-8 byte (surrogate pairs
  // need four bytes for two units). Reject obviously oversized JSON before
  // allocating a potentially multi-megabyte TextEncoder output. For shorter
  // strings still count *bytes*, never treat code-unit length as UTF-8 length.
  const withinLimit = (json: string) =>
    json.length <= MAX_VIEWER_OVERLAY_RESPONSE_BYTES &&
    new TextEncoder().encode(json).byteLength <= MAX_VIEWER_OVERLAY_RESPONSE_BYTES;
  let json = encode(body);
  if (!withinLimit(json)) {
    const noEditor = { ...body, editablePublicChapters: [] };
    json = encode(noEditor);
    if (!withinLimit(json)) {
      // A valid full public R2 playlist can contain 500 long UTF-8 titles.
      // Do not let that optional list bypass the cap on early-return routes.
      json = encode({ ...noEditor, playlistLabel: "再生リスト", playlistItems: [] });
      if (!withinLimit(json)) {
        return c.json({ error: "viewer_overlay_unavailable" }, 503, UNAVAILABLE_HEADERS);
      }
    }
  }
  return c.body(json, 200, {
    ...PRIVATE_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  });
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

    // An editor lookup is one user-selected D1 row, not a playlist view.
    // Skip the unrelated event-playlist R2 read and any large playlist DTO.
    // Duplicate query keys are ambiguous and never grant a targeted edit.
    const requestedChapterIds = c.req.queries("editChapterId") ?? [];
    const requestedChapterId = requestedChapterIds.length === 1 ? requestedChapterIds[0]! : "";
    const targetPublicChapterId = requestedChapterId.length > 0 &&
      requestedChapterId.length <= 128 && requestedChapterId === requestedChapterId.trim()
      ? requestedChapterId : null;
    const playlist = (c.req.query("playlist") ?? "").trim().slice(0, 128);
    const playlistEventTitle = playlist
      ? detail.publicEvents.find((event) => event.id === playlist)?.title ?? null
      : null;

    const publicPlaylist: Pick<VideoViewerOverlayDto, "playlistLabel" | "playlistItems"> =
      targetPublicChapterId
        ? { playlistLabel: "再生リスト", playlistItems: [] }
        : await loadStaticEventPlaylistOverlay(
            c.env.BUCKET,
            c.env.PUBLIC_VISIBILITY_GUARD_MODE,
            playlist,
            playlistEventTitle,
          );

    const operationMode = await resolvePublicOperationMode(c.env, { allowD1: false });
    if (!isLiveApiEnabled(operationMode)) {
      return boundedOverlayResponse(c, emptyOverlay(publicPlaylist));
    }

    await resolveSession(c, async () => {});
    if (c.get("sessionState") === "unavailable") {
      return boundedOverlayResponse(c, {
        ...emptyOverlay(publicPlaylist),
        authUnavailable: true,
      });
    }

    const viewer = c.get("user");
    if (!viewer) {
      return boundedOverlayResponse(c, emptyOverlay(publicPlaylist));
    }

    // CURRENT getCurrentUserContext: the user row (terms) and the approved linked X ids are read for
    // every signed-in viewer, banned included; a failed read is "auth unavailable" (signed out shape).
    const authUnavailable = () =>
      boundedOverlayResponse(c, { ...emptyOverlay(publicPlaylist), authUnavailable: true });
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
      if (!row1?.user_json) return boundedOverlayResponse(c, emptyOverlay(publicPlaylist));

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
      // SA-012..015 require an approved active X even for administrators.
      // Keep the broader management role for private read visibility only.
      const viewerCanWriteChapters = viewerXApproved && isTosAccepted && !termsReacceptRequired && viewer.is_banned !== 1;

      if (viewer.is_banned === 1) {
        return boundedOverlayResponse(c, {
          ...emptyOverlay(publicPlaylist),
          loggedIn: true,
          isBanned: true,
          isTosAccepted,
          termsReacceptRequired,
          activeXId,
        });
      }
      degraded = { isTosAccepted, termsReacceptRequired, activeXId, viewerXApproved };

      let viewerCanEditChapters = false;
      let matchesPublicD1Video = false;
      if (row1.video_json) {
        const videoData = JSON.parse(row1.video_json) as {
          id: string;
          primary_event_id: string | null;
          visibility_status: string;
          ve_json: unknown;
          staff_json: unknown;
        };
        if (videoData.id === detail.video.id) {
          // A stale R2 artifact must not grant public chapter editing after
          // the canonical D1 video has been made private.
          matchesPublicD1Video = videoData.visibility_status === "public";
          viewerCanEditChapters = canAdministerChapters(viewer.role, approvedXIds, {
            primary_event_id: videoData.primary_event_id,
            access: parseAccessFacts(videoData.ve_json, videoData.staff_json),
          });
        }
      }

      // A stale R2 public artifact is not authority to offer chapter mutation
      // controls when D1 has already revoked the video's public visibility.
      const mayManagePublicView = viewerCanWriteChapters && matchesPublicD1Video;
      const canSeeAllPrivate = viewer.role === "admin" || viewerCanEditChapters;
      // The ordinary viewer overlay never reads public editing notes. An
      // explicit single-row request is not an authorization claim: the same
      // SQL, Active-X, terms, approval and chapter-admin gates still apply.
      // Targeted requests only need an edit grant, not the unrelated private
      // chapter list; keep the response small without a fourth D1 statement.
      const canSeeAnyPrivate = !targetPublicChapterId && (canSeeAllPrivate || approvedXIds.length > 0);
      // A targeted editor lookup must also avoid the unrelated 500-item
      // personal library aggregation when given a playlist query parameter.
      const isLibPlaylist = !targetPublicChapterId &&
        (playlist === "lib-like" || playlist === "lib-bookmark");
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
              'author_icon', c."author_icon",
              'chapter_owner_x_id', c."x_user_id"
           )), '[]')
           FROM (
             SELECT ch."id", ch."chapter_time", ch."chapter_label", ch."note", ch."x_user_id", u."x_name" AS "author_name", u."icon_url" AS "author_icon"
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

      // Issue #661: return full note/visibility from D1 for one explicitly
      // requested row only. A signed SSG row is not a write grant; owner
      // link and manager permissions are rechecked within the existing D1
      // statement. No public chapter SELECT runs on normal page loads.
      const editablePublicSubquery = mayManagePublicView && targetPublicChapterId
        ? `(SELECT coalesce(json_group_array(json_object(
              'id', c."id",
              'chapter_time', c."chapter_time",
              'chapter_label', c."chapter_label",
              'visibility', 'public',
              'note', c."note",
              'chapter_owner_x_id', c."x_user_id"
           )), '[]')
           FROM (
             SELECT ch."id", ch."chapter_time", ch."chapter_label", ch."note", ch."x_user_id"
               FROM "video_chapters" ch
              WHERE ch."video_id" = ? AND ch."visibility" = 'public'
                AND ch."id" = ?
                AND (${viewerCanEditChapters ? "1=1" : `ch."x_user_id" = ? AND EXISTS (
                  SELECT 1 FROM "x_user_account_links" l
                  INNER JOIN "x_users" xu ON xu."id" = l."x_user_id"
                  WHERE l."auth_user_id" = ? AND l."x_user_id" = ch."x_user_id"
                    AND xu."approval_status" = 'approved'
                )`})
                AND ch."id" NOT LIKE '%:member:%'
                AND ch."id" NOT LIKE '%:legacy:%'
              ORDER BY ch."chapter_time" ASC, ch."id" ASC
              LIMIT 1
           ) c) AS editable_public_chapters_json`
        : `'[]' AS editable_public_chapters_json`;

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
        ${editablePublicSubquery},
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
      if (mayManagePublicView && targetPublicChapterId) {
        stmt2Binds.push(detail.video.id, targetPublicChapterId);
        if (!viewerCanEditChapters) stmt2Binds.push(activeXId, viewer.id);
      }
      stmt2Binds.push(viewer.id, detail.video.id);
      if (isLibPlaylist) {
        stmt2Binds.push(viewer.id, libKind);
      }

      const row2 = await c.env.DB.prepare(stmt2Sql)
        .bind(...stmt2Binds)
        .first<{
          chapters_json: string | null;
          editable_public_chapters_json: string | null;
          interactions_json: string | null;
          lib_playlist_json?: string | null;
        }>();

      // Keep raw owner IDs server-side; never expose cross-user X IDs in RH-031.
      // Edit/delete accepts owner of the *active* X identity or operator rights.
      const privateChapters = parseJsonArray<
        VideoViewerOverlayDto["privateChapters"][number] & { chapter_owner_x_id: string | null }
      >(row2?.chapters_json).map(({ chapter_owner_x_id, ...chapter }) => ({
        ...chapter,
        viewerCanManage: mayManagePublicView &&
          (viewerCanEditChapters || Boolean(activeXId && chapter_owner_x_id === activeXId)),
      }));
      // Never send raw chapter-owner X identities to the browser. The SQL
      // grants only authorized rows; re-check the active X before labeling
      // each row manageable, then drop owner metadata unconditionally.
      const editablePublicChapters = parseJsonArray<{
        id: string; chapter_time: number; chapter_label: string;
        note: string | null; visibility: "public"; chapter_owner_x_id: string | null;
      }>(row2?.editable_public_chapters_json)
        .filter((chapter) => mayManagePublicView &&
          (viewerCanEditChapters || Boolean(activeXId && chapter.chapter_owner_x_id === activeXId)))
        .map(({ chapter_owner_x_id: _ownerId, ...chapter }) => ({
          ...chapter,
          viewerCanManage: true as const,
        }));
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
        // Server-side capability only; do not derive from the viewer X approval bit.
        viewerCanEditChapters: viewerCanEditChapters && mayManagePublicView,
        privateChapters,
        editablePublicChapters,
        ...finalPlaylist,
      };

      // Public editor rows are requested one at a time, with original notes.
      // Notes must be complete when offered for PUT. If the response would
      // exceed S2's 64KiB limit, fail closed instead of truncating any note,
      // returning a partially usable editor, or serializing an oversized body.
      return boundedOverlayResponse(c, result);
    } catch (error) {
      console.error("[video-viewer-overlay] db read failed", { rawId, error });
      if (!degraded) return authUnavailable();
      // CURRENT: the viewer is known, the overlay read failed.
      return boundedOverlayResponse(c, {
        ...emptyOverlay(publicPlaylist),
        loggedIn: true,
        authUnavailable: true,
        ...degraded,
      });
    }
  });

  return routes;
}

export const videoViewerOverlayRoutes = createVideoViewerOverlayRoutes();
