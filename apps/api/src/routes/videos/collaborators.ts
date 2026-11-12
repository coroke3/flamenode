/**
 * MIG-0650 U02 candidate: SA-082/083/084 Hono collaborator permission writes.
 *
 * Intentionally UNMOUNTED until a separate owner integrates the video router,
 * current writeGuard(edit_video) / session / origin / CostGuard are verified,
 * and the host supplies the after-commit Queue wake port. No handler in this
 * module can be reached just by importing it.
 *
 * The host must supply the complete guard stack and a request-scoped wake
 * loader; this code never obtains elevated authorization on its own.
 */
import {
  parseVideoCollaboratorDeleteInput,
  permissionBatchSchema,
  upsertSchema,
  type CollaboratorPermissionIntent,
} from "@flamenode/domain/video";
import { validateNotificationPayload } from "@flamenode/domain/notifications/payload";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { generateId } from "@flamenode/server-core/id";
import type { QueueWakeHost } from "@flamenode/server-core/ports";
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import { loadAuthorizedPermissionVideo } from "@flamenode/server-core/video/permissionAccess";
import { buildPermissionMutationBatch } from "@flamenode/server-core/video/permissionMutationBatch";
import { preparePermissionNotificationBulkBatch } from "@flamenode/server-core/video/permissionNotificationBatch";
import { buildPermissionGrantNotificationInputs } from "@flamenode/server-core/video/permissionNotificationInputs";
import { buildPermissionWriteAudits } from "@flamenode/server-core/video/permissionPlan";
import { preparePermissionWrite } from "@flamenode/server-core/video/permissionPreparation";
import { permissionRebuildTargets } from "@flamenode/server-core/video/permissionRebuildTargets";
import { loadNotifiableRecipientLinks } from "@flamenode/server-core/video/permissionRecipients";
import { resolvePermissionSubjectXUserId } from "@flamenode/server-core/video/permissionSubject";
import { buildPermissionGrantDm } from "@flamenode/server-core/video/permissionGrantDm";
import { loadVideoRebuildEventIds } from "@flamenode/server-core/video/rebuildEventIds";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../env.ts";
import { sessionMiddleware } from "../../auth/session.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";

type Ctx = Context<AppEnv>;
type AuthorizedVideo = NonNullable<Awaited<ReturnType<typeof loadAuthorizedPermissionVideo>>>;
type Result = { ok: boolean; message?: string; granted?: string[]; revoked?: string[]; unchanged?: number };
type Status = 200 | 400 | 403 | 404 | 413 | 500 | 503;
type WriteInput = {
  videoId: string;
  privilegeMode: string;
  notify: boolean;
  intents: readonly CollaboratorPermissionIntent[];
  successMessage?: string;
};

/** The caller owns the authenticated edit_video middleware and Queue host. */
export type VideoCollaboratorHost = {
  writeGuard: MiddlewareHandler<AppEnv>;
  loadWakeHost: (c: Ctx) => Promise<QueueWakeHost>;
};


/**
 * Unmounted future host wiring: origin (without D1) -> session -> identity/TOS
 * -> CostGuard(edit_video) -> Drizzle. The active router does not import this.
 * All denied requests receive no-store, including a failed origin/session.
 *
 * Exposed alongside the candidate routes so a later owner can validate and
 * mount one reviewed guard stack instead of reassembling it ad hoc.
 */
export function createDefaultVideoCollaboratorHost(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): VideoCollaboratorHost {
  const originOptions = (c: Ctx) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  const stack: MiddlewareHandler<AppEnv>[] = [
    (c, next) => originGuardMiddleware(originOptions(c))(c, next),
    options.session ?? (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>),
    (c, next) => writeGuardMiddleware({
      ...originOptions(c),
      requiredRole: null,
      // No approved Active X requirement for permission management itself.
      // CostGuard must still execute before the handler, even for admins.
    })(c, next),
    costGuardMiddleware("edit_video") as MiddlewareHandler<AppEnv>,
    dbMiddleware,
  ];
  return {
    writeGuard: async (c, next) => {
      c.header("Cache-Control", "private, no-store");
      const run = async (index: number): Promise<Response | void> => {
        if (index === stack.length) return next();
        let inner: Response | void;
        const own = await stack[index]!(c, async () => {
          inner = await run(index + 1);
        });
        return own ?? inner;
      };
      return run(0);
    },
    loadWakeHost: async (c) => ({
      readEnv: () => {
        try {
          return c.env as unknown as Readonly<Record<string, unknown>>;
        } catch {
          return null;
        }
      },
      readWaitUntil: () => {
        try {
          const ctx = c.executionCtx;
          return ctx.waitUntil.bind(ctx);
        } catch {
          return null;
        }
      },
      readKv: () => {
        try {
          return c.env.KV ?? null;
        } catch {
          return null;
        }
      },
    }),
  };
}

function response(c: Ctx, status: Status, body: Result) {
  c.header("Cache-Control", "private, no-store");
  return c.json(body, status);
}
function failure(c: Ctx, status: Exclude<Status, 200>, message: string) {
  return response(c, status, { ok: false, message });
}

function configuredEditUrl(c: Ctx, videoId: string): string {
  // Never trust an origin, hostname or edit URL supplied in request JSON.
  const raw = c.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) throw new Error("site_origin_unavailable");
  const url = new URL(raw);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) throw new Error("site_origin_unavailable");
  if (
    url.protocol === "http:" &&
    c.env.FLAMENODE_LOCAL_PREVIEW !== "1"
  ) throw new Error("site_origin_unavailable");
  return new URL("/dashboard/edit/" + encodeURIComponent(videoId), url.origin).href;
}

function videoIdMatches(body: Record<string, unknown>, pathId: string): boolean {
  return body.video_id === undefined || body.video_id === pathId;
}

function hasCompleteWriteContext(c: Ctx): boolean {
  return Boolean(c.get("user") && c.get("db") && c.get("auditSettings") && c.get("actorSnapshotJsonById"));
}

/**
 * The D1 transaction is already committed when mutateWithAudit asks for the
 * Queue port. A missing runtime binding must not convert a successful write
 * into an HTTP 500 (and induce a dangerous client retry).
 */
async function loadWakeHostBestEffort(host: VideoCollaboratorHost, c: Ctx): Promise<QueueWakeHost> {
  try {
    return await host.loadWakeHost(c);
  } catch {
    // sendQueueWakeBestEffort handles a null environment as dispatch-disabled.
    // The durable notification/static rebuild rows stay pending for recovery.
    return {
      readEnv: () => null,
      readWaitUntil: () => null,
      readKv: () => null,
    };
  }
}

/**
 * This helper uses ONLY the request-scoped Drizzle handle supplied by the
 * authenticated write stack. It must never fetch a second D1 binding.
 */
async function executePermissionWrite(
  c: Ctx, host: VideoCollaboratorHost, input: WriteInput, authorized?: AuthorizedVideo,
) {
  const actor = c.get("user");
  const db = c.get("db");
  // A missing preloaded context implies the supplied writeGuard is incomplete.
  // Reject before making any video/permission D1 reads.
  if (!hasCompleteWriteContext(c) || !actor || !db) {
    return failure(c, 503, "書込認証を確認できませんでした。");
  }

  try {
    const video = authorized ?? await loadAuthorizedPermissionVideo(
      db,
      { id: actor.id, role: actor.role ?? null },
      input.videoId,
      input.privilegeMode,
    );
    if (!video) {
      return failure(c, 404, "対象作品が見つからない、または権限がありません。");
    }
    const preparation = await preparePermissionWrite(db, {
      videoId: video.id,
      actorId: actor.id,
      intents: input.intents,
      notify: input.notify,
      now: Math.floor(Date.now() / 1000),
      makeMemberId: () => generateId("vm"),
    });
    if (preparation.kind === "error") return failure(c, 400, preparation.message);
    if (preparation.kind === "terminal") {
      return response(c, preparation.result.ok ? 200 : 400, preparation.result);
    }

    const { xids, existingRows, currentHiddenEditorCount, plan } = preparation;
    const mutation = buildPermissionMutationBatch(db, {
      videoId: video.id, xids, existingRows, currentHiddenEditorCount, plan,
    });
    const statements = [...mutation.statements];
    const expected: Array<number | null> = [...mutation.expectedChanges];
    const audits = buildPermissionWriteAudits({
      videoId: video.id,
      actorUserId: actor.id,
      privilegeMode: video.privilegeMode,
      existingRows,
      plan,
    });

    let notificationWakeSource: "manage" | undefined;
    if (plan.notifyXids.length > 0) {
      const editUrl = configuredEditUrl(c, video.id);
      const links = await loadNotifiableRecipientLinks(db, plan.notifyXids);
      const recipients = buildPermissionGrantNotificationInputs({
        links,
        actorUserId: actor.id,
        videoId: video.id,
        videoTitle: video.title,
        eventId: video.primary_event_id,
        buildPayload: ({ videoId, videoTitle }) =>
          buildPermissionGrantDm({ videoId, videoTitle, editUrl }),
      });
      for (let offset = 0; offset < recipients.length; offset += 200) {
        const part = preparePermissionNotificationBulkBatch(
          recipients.slice(offset, offset + 200),
          validateNotificationPayload,
        );
        if (part.statement) {
          statements.push(db.run(part.statement));
          expected.push(...part.expectedChanges);
          notificationWakeSource = "manage";
        }
      }
    }

    const events = await loadVideoRebuildEventIds(db, video.id, video.primary_event_id);
    if (!events.ok) return failure(c, 400, events.message);
    const queue = await buildStaticRebuildQueueBatch(db, permissionRebuildTargets({
      hasNewXUsers: plan.newXUsers.length > 0,
      visibilityStatus: video.visibility_status,
      eventIds: events.eventIds,
      actorUserId: actor.id,
    }));
    statements.push(...queue.statements);
    expected.push(...queue.expectedChanges);

    // CAS + permission DML + outbox + rebuild records + strict audit share
    // exactly ONE atomic D1 batch. Queue wakes fire only after commit.
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
      audits,
      preloaded: auditPreloaded(c),
      notificationWakeSource,
      staticRebuildWakeSource: queue.statements.length > 0 ? "manage" : undefined,
    }, () => loadWakeHostBestEffort(host, c));

    return response(c, 200, {
      ok: true,
      message: input.successMessage ??
        ("編集権限を反映しました（付与 " + plan.grantedNames.length +
         " / 解除 " + plan.revokedNames.length +
         " / 変更なし " + plan.unchanged + "）"),
      granted: plan.grantedNames,
      revoked: plan.revokedNames,
      unchanged: plan.unchanged,
    });
  } catch {
    // No DB details, token, payload or request data in error logs/responses.
    return failure(c, 500, "編集権限・通知・監査の更新に失敗しました。最新状態を確認して再試行してください。");
  }
}

async function parseBody(c: Ctx) {
  const read = await readAdminJsonBody(c.req.raw);
  if (read.kind === "too_large") {
    return { ok: false as const, response: failure(c, 413, BODY_TOO_LARGE_MESSAGE) };
  }
  if (read.kind !== "ok") {
    return { ok: false as const, response: failure(c, 400, "入力エラー") };
  }
  return { ok: true as const, value: read.value };
}

/**
 * Unmounted route candidates:
 *   POST   /:videoId/collaborators         SA-082
 *   DELETE /:videoId/collaborators         SA-083
 *   POST   /:videoId/collaborators/batch   SA-084
 *
 * Hono-side Guard / CostGuard / Queue port / HTTP integration and live D1
 * parity must be independently reviewed before the owner mounts this router.
 */
export function createVideoCollaboratorRoutes(host: VideoCollaboratorHost): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post("/:videoId/collaborators", host.writeGuard, async (c) => {
    const body = await parseBody(c);
    if (!body.ok) return body.response;
    const videoId = c.req.param("videoId");
    if (!videoIdMatches(body.value, videoId)) return failure(c, 400, "video_id が一致しません。");
    const parsed = upsertSchema.safeParse({ ...body.value, video_id: videoId });
    if (!parsed.success) return failure(c, 400, parsed.error.issues[0]?.message ?? "入力エラー");

    const actor = c.get("user");
    const db = c.get("db");
    if (!hasCompleteWriteContext(c) || !actor || !db) {
      return failure(c, 503, "書込認証を確認できませんでした。");
    }
    try {
      const video = await loadAuthorizedPermissionVideo(
        db, { id: actor.id, role: actor.role ?? null }, videoId,
        typeof body.value.edit_privilege_mode === "string" ? body.value.edit_privilege_mode : "",
      );
      if (!video) return failure(c, 404, "対象作品が見つからない、または権限がありません。");
      const subject = await resolvePermissionSubjectXUserId(
        db, parsed.data.x_user_id || null, parsed.data.user_id?.trim() || null,
      );
      if (!subject.ok) return failure(c, 400, subject.message);
      // The authorized video is request-local; reuse it, do not repeat the
      // potentially expensive D1 authorization query for the same write.
      return executePermissionWrite(c, host, {
        videoId, privilegeMode: video.privilegeMode,
        notify: parsed.data.notify,
        intents: [{ x_user_id: subject.xUserId, display_name: parsed.data.display_name,
          intent: parsed.data.can_edit ? "on" : "off" }],
        successMessage: parsed.data.can_edit
          ? "作品編集への参加を付与しました。" : "作品編集への参加を無効化しました。",
      }, video);
    } catch {
      return failure(c, 500, "合作権限の読込・更新に失敗しました。");
    }
  });
  routes.delete("/:videoId/collaborators", host.writeGuard, async (c) => {
    const body = await parseBody(c);
    if (!body.ok) return body.response;
    const videoId = c.req.param("videoId");
    if (!videoIdMatches(body.value, videoId)) return failure(c, 400, "video_id が一致しません。");
    const parsed = parseVideoCollaboratorDeleteInput({
      video_id: videoId, x_user_id: body.value.x_user_id,
    });
    if (!parsed.ok) return failure(c, 400, parsed.message);
    const actor = c.get("user");
    const db = c.get("db");
    if (!hasCompleteWriteContext(c) || !actor || !db) {
      return failure(c, 503, "書込認証を確認できませんでした。");
    }
    try {
      const video = await loadAuthorizedPermissionVideo(
        db, { id: actor.id, role: actor.role ?? null }, parsed.videoId,
        typeof body.value.edit_privilege_mode === "string" ? body.value.edit_privilege_mode : "",
      );
      if (!video) return failure(c, 404, "対象作品が見つからない、または権限がありません。");
      const subject = await resolvePermissionSubjectXUserId(db, parsed.xUserId, null);
      if (!subject.ok) return failure(c, 400, subject.message);
      return executePermissionWrite(c, host, {
        videoId: parsed.videoId, privilegeMode: video.privilegeMode, notify: false,
        intents: [{ x_user_id: subject.xUserId, display_name: "@" + subject.xUserId, intent: "off" }],
        successMessage: "作品編集への参加を解除しました。",
      }, video);
    } catch {
      return failure(c, 500, "合作権限の読込・解除に失敗しました。");
    }
  });
  routes.post("/:videoId/collaborators/batch", host.writeGuard, async (c) => {
    const body = await parseBody(c);
    if (!body.ok) return body.response;
    const videoId = c.req.param("videoId");
    if (!videoIdMatches(body.value, videoId)) return failure(c, 400, "video_id が一致しません。");
    const parsed = permissionBatchSchema.safeParse({ ...body.value, video_id: videoId });
    if (!parsed.success) return failure(c, 400, parsed.error.issues[0]?.message ?? "入力エラー");
    return executePermissionWrite(c, host, {
      videoId, privilegeMode: parsed.data.edit_privilege_mode ?? "",
      notify: parsed.data.notify, intents: parsed.data.intents,
    });
  });
  return routes;
}
