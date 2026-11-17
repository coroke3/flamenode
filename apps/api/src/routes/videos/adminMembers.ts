/**
 * MIG-0650 U03e: UNMOUNTED SA-085 admin-members PUT preflight candidate.
 *
 * The authenticated Hono D1 member/chapters CAS + strict audit + static
 * rebuild host has not yet been implemented. This candidate MUST return 501
 * even for a valid request. Never mount it or represent it as a working writer.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { readAdminVideoCollabFlag, mergeVideoRebuildEventIds } from "@flamenode/domain/video";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "@flamenode/server-core/staticRebuild/hooks";
import { isValidAdminVideoMemberPathId, parseAdminVideoMembersHttpInput } from "@flamenode/domain/video/adminMemberHttpInput";
import { validateVideoMemberSubmission } from "@flamenode/domain/video/adminMemberSubmission";
import type { AppEnv } from "../../env.ts";
import { sessionMiddleware } from "../../auth/session.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { BODY_TOO_LARGE_MESSAGE } from "../admin/body.ts";
import { readAdminVideoMembersJsonBody } from "./adminMembersBody.ts";

type Ctx = Context<AppEnv>;

/** Authoritative, bounded D1 snapshot required for future SA-085 CAS/audit/Queue. */
export type AdminVideoMemberTarget = {
  id: string;
  collaboration_type: "individual" | "collab";
  visibility_status: "pending" | "public" | "private" | "voided";
  creator_x_user_id: string | null;
  youtube_video_id: string | null;
  primary_event_id: string | null;
  updated_at: number;
  /** JSON1 bounded linked event IDs fetched with the same video snapshot D1 SELECT. */
  linked_event_ids_json: string;
};

export type VideoAdminMembersPreflightHost = {
  writeGuard: MiddlewareHandler<AppEnv>;
  // A missing or stale video must not reach a future SA-085 mutation port.
  // This is one authoritative D1 read, after identity and CostGuard preflight.
  loadAuthorizedVideo: (c: Ctx, videoId: string) => Promise<AdminVideoMemberTarget | null>;
};

/**
 * Required order before any request body or member data is inspected:
 * origin -> session -> admin identity/TOS -> CostGuard(edit_video) -> db.
 * This merely prepares the UNMOUNTED preflight; no host mutation port exists.
 */
export function createDefaultVideoAdminMembersPreflightHost(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): VideoAdminMembersPreflightHost {
  const originOptions = (c: Ctx) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  const stack: MiddlewareHandler<AppEnv>[] = [
    (c, next) => originGuardMiddleware(originOptions(c))(c, next),
    options.session ?? (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>),
    (c, next) => writeGuardMiddleware({
      ...originOptions(c),
      requiredRole: "admin",
    })(c, next),
    costGuardMiddleware("edit_video") as MiddlewareHandler<AppEnv>,
    dbMiddleware,
  ];
  return {
    loadAuthorizedVideo: (c, videoId) =>
      c.env.DB.prepare(
        'SELECT "id", "collaboration_type", "visibility_status", ' +
        '"creator_x_user_id", "youtube_video_id", "primary_event_id", "updated_at", ' +
        '(SELECT COALESCE(json_group_array("event_id"), \'[]\') FROM (' +
        'SELECT "event_id" FROM "video_events" WHERE "video_id" = ? ' +
        'ORDER BY "event_id" LIMIT ' + (MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS + 1) +
        ')) AS "linked_event_ids_json" ' +
        'FROM "videos" WHERE "id" = ? LIMIT 1',
      ).bind(videoId, videoId).first<AdminVideoMemberTarget>(),
    writeGuard: async (c, next) => {
      c.header("Cache-Control", "private, no-store");
      const execute = async (index: number): Promise<Response | void> => {
        if (index === stack.length) return next();
        let child: Response | void = undefined;
        const result = await stack[index]!(c, async () => {
          child = await execute(index + 1);
        });
        return result ?? child;
      };
      return execute(0);
    },
  };
}

function reject(c: Ctx, status: 400 | 403 | 404 | 413 | 501 | 503, message: string): Response {
  c.header("Cache-Control", "private, no-store");
  return c.json({ ok: false, message }, status);
}

/** NOT mounted in createVideosRoutes. No D1 mutation or Queue wake exists. */
export function createVideoAdminMembersPreflightRoutes(
  host: VideoAdminMembersPreflightHost,
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.put("/:videoId/members", host.writeGuard, async c => {
    c.header("Cache-Control", "private, no-store");
    const actor = c.get("user");
    const db = c.get("db");
    if (!actor || !db || !c.get("auditSettings") || !c.get("actorSnapshotJsonById")) {
      return reject(c, 503, "書込認証を確認できませんでした。");
    }
    if (actor.role !== "admin") return reject(c, 403, "管理者権限が必要です。");

    // This is a JSON-only privileged API. Reject form/text/suffix media types
    // before consuming the bounded body, even if the bytes happen to be JSON.
    // A charset parameter is allowed (the Ops client uses application/json).
    const mediaType = c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") {
      return reject(c, 400, "JSON形式の入力が必要です。");
    }
    // Admin/TOS/CostGuard and media-type checks precede validation. Reject an
    // invalid path without spending Worker CPU on up to 256KiB of JSON bytes.
    const videoId = c.req.param("videoId");
    if (!isValidAdminVideoMemberPathId(videoId)) {
      return reject(c, 400, "対象作品が指定されていません。");
    }
    const body = await readAdminVideoMembersJsonBody(c.req.raw);
    if (body.kind === "too_large") return reject(c, 413, BODY_TOO_LARGE_MESSAGE);
    if (body.kind !== "ok") return reject(c, 400, "入力エラー");

    const parsed = parseAdminVideoMembersHttpInput(videoId, body.value);
    if (!parsed.ok) return reject(c, 400, parsed.message);
    const isCollab = readAdminVideoCollabFlag(parsed.formData);
    const members = validateVideoMemberSubmission(parsed.formData, isCollab);
    if (!members.ok) return reject(c, 400, members.message);

    // The current Next SA-085 action checks the authoritative video row
    // before planning mutations. One bounded D1 query remains inside the
    // ZERO_1102 pre-write budget (guard actor + CostGuard + target video).
    // Never trust target metadata supplied through the request body.
    let target: AdminVideoMemberTarget | null;
    try {
      target = await host.loadAuthorizedVideo(c, videoId);
    } catch {
      return reject(c, 503, "作品の確認に失敗しました。");
    }
    if (!target) return reject(c, 404, "作品が見つかりません。");
    // A correct ID alone is insufficient for future CAS and rebuild planning:
    // reject missing or malformed target facts before a privileged write port
    // could ever consume them. No body-supplied metadata is trusted.
    if (
      target.id !== videoId ||
      (target.collaboration_type !== "individual" && target.collaboration_type !== "collab") ||
      !["pending", "public", "private", "voided"].includes(target.visibility_status) ||
      !Number.isSafeInteger(target.updated_at) ||
      [target.creator_x_user_id, target.youtube_video_id, target.primary_event_id].some(
        value => value !== null && typeof value !== "string",
      )
    ) {
      return reject(c, 503, "作品の確認に失敗しました。");
    }

    // Fetch linked events in the same bounded SELECT as the video snapshot:
    // pre-write guard + CostGuard + this SELECT stay within 3 D1 pre-reads.
    // The ninth linked event is a deliberate overflow sentinel. Never silently
    // truncate the canonical rebuild targets or enqueue an incomplete fanout.
    let linkedEventIds: unknown;
    try {
      linkedEventIds = JSON.parse(target.linked_event_ids_json);
    } catch {
      return reject(c, 503, "作品の確認に失敗しました。");
    }
    if (!Array.isArray(linkedEventIds) ||
        linkedEventIds.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS + 1 ||
        linkedEventIds.some(id => typeof id !== "string" || !id || id.trim() !== id)) {
      return reject(c, 503, "作品の確認に失敗しました。");
    }
    const rebuildEventIds = mergeVideoRebuildEventIds(
      target.primary_event_id, linkedEventIds as string[],
    );
    if (rebuildEventIds.length > MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS) {
      return reject(c, 400, "関連イベント数が処理上限を超えています。");
    }

    // Validity is not authorization to mutate the video. We have no Hono
    // atomic member CAS/audit plan or Queue port yet.
    // Deliberately never return a successful save response.
    return reject(c, 501, "参加者設定の保存APIは移行準備中です。");
  });
  return routes;
}
