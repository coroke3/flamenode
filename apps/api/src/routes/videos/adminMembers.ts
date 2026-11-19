/**
 * MIG-0650 U03cr: UNMOUNTED SA-085 admin-members PUT candidate.
 *
 * The default production-facing factory remains PREVIEW/DISABLED and returns
 * HTTP 501 even for a valid request. An explicitly opted-in isolated test host
 * exercises authenticated CAS + strict audit + static rebuild Queue in SQLite;
 * it is NOT mounted in createVideosRoutes, has not passed exact-HEAD CI or
 * workerd payload/CPU parity, and must never be used as a live writer.
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { readAdminVideoCollabFlag, mergeVideoRebuildEventIds } from "@flamenode/domain/video";
import { MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS } from "@flamenode/server-core/staticRebuild/hooks";
import { isValidAdminVideoMemberPathId, parseAdminVideoMembersHttpInput } from "@flamenode/domain/video/adminMemberHttpInput";
import { validateVideoMemberSubmission } from "@flamenode/domain/video/adminMemberSubmission";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import type { AppEnv } from "../../env.ts";
import { sessionMiddleware } from "../../auth/session.ts";
import { createAdminMemberAtomicWriteDb, dbMiddleware } from "../../middleware/db.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import { BODY_TOO_LARGE_MESSAGE } from "../admin/body.ts";
import { readAdminVideoMembersJsonBody } from "./adminMembersBody.ts";
import { createAdminMemberD1ReadMeter, sealAdminMemberD1ReadMeter, type AdminMemberD1ReadMeter } from "./adminMemberD1ReadMeter.ts";
import { prepareAdminVideoMemberCandidateWrite } from "@flamenode/server-core/video/adminMemberCandidatePrepare";
import { executeAdminMemberAtomicCandidate, prepareAdminMemberAtomicExecution } from "@flamenode/server-core/video/adminMemberAtomicExecute";
import type { ValidatedMemberSubmission } from "@flamenode/domain/video/adminMemberSubmission";

type Ctx = Context<AppEnv>;

/** Authoritative, bounded D1 snapshot required for future SA-085 CAS/audit/Queue. */
export type AdminVideoMemberTarget = {
  id: string;
  collaboration_type: "individual" | "collab";
  // All schema-valid states must pass preflight; this path also handles
  // existing draft, limited and archived videos in CURRENT Next.
  visibility_status: "draft" | "pending" | "public" | "limited" | "private" | "archived" | "voided";
  creator_x_user_id: string | null;
  youtube_video_id: string | null;
  primary_event_id: string | null;
  updated_at: number;
  /** Bounded count of existing public participants; 101 is overflow. */
  public_member_count: number;
  /** JSON1 bounded linked event IDs fetched with the same video snapshot D1 SELECT. */
  linked_event_ids_json: string;
};

export type VideoAdminMembersPreflightHost = {
  writeGuard: MiddlewareHandler<AppEnv>;
  // A missing or stale video must not reach a future SA-085 mutation port.
  // This is one authoritative D1 read, after identity and CostGuard preflight.
  loadAuthorizedVideo: (c: Ctx, videoId: string) => Promise<AdminVideoMemberTarget | null>;
  /**
   * Optional TEST/REVIEW-ONLY dry-run. Reads an authenticated D1 snapshot,
   * composes the canonical member/chapters/CAS/audit/Queue plan, and NEVER
   * executes D1 mutation or responds with success. Not installed by default.
   */
  previewCanonicalPlan?: (c: Ctx, input: {
    videoId: string;
    target: AdminVideoMemberTarget;
    validated: ValidatedMemberSubmission;
    isCollab: boolean;
    eventIds: readonly string[];
  }) => Promise<void>;
  /**
   * UNMOUNTED test/review-only opt-in: execute the audited D1 batch after
   * sealing the authenticated read-meter. Never installed by default.
   */
  commitCanonicalPlan?: (c: Ctx, input: {
    videoId: string;
    target: AdminVideoMemberTarget;
    validated: ValidatedMemberSubmission;
    isCollab: boolean;
    eventIds: readonly string[];
  }) => Promise<{ committed: boolean; pendingPublicReflection: boolean }>;
};

/**
 * Required order before any request body or member data is inspected:
 * origin -> session -> admin identity/TOS -> CostGuard(edit_video) -> db.
 * This merely prepares the UNMOUNTED preflight; no host mutation port exists.
 */
export function createDefaultVideoAdminMembersPreflightHost(
  options: {
    session?: MiddlewareHandler<AppEnv>;
    enableCanonicalDryRun?: boolean;
    /** For isolated SQLite integration only, never passed by the live router. */
    enableAtomicCandidateWrite?: boolean;
  } = {},
): VideoAdminMembersPreflightHost {
  if (options.enableCanonicalDryRun && options.enableAtomicCandidateWrite) {
    throw new RangeError("video_admin_member_candidate_conflicting_execution_modes");
  }
  const originOptions = (c: Ctx) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  // Hono's Context.env exposes provider bindings. Do NOT overwrite them on
  // the original request or mutate the shared Worker environment. Instead,
  // scope a metered, read-only overlay to this UNMOUNTED guard invocation.
  // Direct loadAuthorizedVideo() probes outside an HTTP request retain their
  // existing test-only semantics; requests always use the guarded overlay.
  const guardedContexts = new WeakMap<Ctx, Ctx>();
  const activeMeters = new WeakMap<Ctx, AdminMemberD1ReadMeter>();
  // A target may be used for a write only when the same authenticated request
  // actually obtained that exact video snapshot from its authoritative SELECT.
  const authorizedTargets = new WeakMap<Ctx, { videoId: string; target: AdminVideoMemberTarget }>();
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
    loadAuthorizedVideo: async (c, videoId) => {
      const target = await (guardedContexts.get(c) ?? c).env.DB.prepare(
        'SELECT "id", "collaboration_type", "visibility_status", ' +
        '"creator_x_user_id", "youtube_video_id", "primary_event_id", "updated_at", ' +
        '(SELECT COALESCE(json_group_array("event_id"), \'[]\') FROM (' +
        'SELECT "event_id" FROM "video_events" WHERE "video_id" = ? ' +
        'ORDER BY "event_id" LIMIT ' + (MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS + 1) +
        ')) AS "linked_event_ids_json", ' +
        '(SELECT COUNT(*) FROM (' +
        'SELECT 1 FROM "video_members" WHERE "video_id" = ? AND "is_public_member" = 1 ' +
        'LIMIT ' + (MAX_VIDEO_MEMBERS + 1) +
        ')) AS "public_member_count" ' +
        'FROM "videos" WHERE "id" = ? LIMIT 1',
      ).bind(videoId, videoId, videoId).first<AdminVideoMemberTarget>();
      if (target && guardedContexts.has(c)) {
        authorizedTargets.set(c, { videoId, target });
      }
      return target;
    },
    ...(options.enableCanonicalDryRun ? {
      previewCanonicalPlan: async (c: Ctx, input: {
        videoId: string;
        target: AdminVideoMemberTarget;
        validated: ValidatedMemberSubmission;
        isCollab: boolean;
        eventIds: readonly string[];
      }) => {
        const meter = activeMeters.get(c);
        const actor = c.get("user");
        const db = c.get("db");
        const settings = c.get("auditSettings");
        const snapshots = c.get("actorSnapshotJsonById");
        const selected = authorizedTargets.get(c);
        if (!meter || !actor || actor.role !== "admin" || !db || !settings ||
            !snapshots || !snapshots[actor.id] ||
            selected?.videoId !== input.videoId || selected.target !== input.target) {
          throw new RangeError("video_admin_member_preview_not_authorized");
        }
        // The db passed by dbMiddleware belongs to the request's READ-ONLY
        // metered D1 facade. There is no write-capable handle in this port.
        const prepared = await prepareAdminVideoMemberCandidateWrite(db, {
          target: input.target, videoId: input.videoId,
          actorUserId: actor.id,
          validated: input.validated,
          isCollab: input.isCollab,
          eventIds: input.eventIds,
          now: Math.floor(Date.now() / 1000),
          preloaded: { settings, actorSnapshotJsonById: snapshots },
          readMeasuredCallerQueries: () => meter.readCount(),
        });
        // Close ALL read access before a future Hono write-only handoff.
        // A forged or stale count must fail even for a valid-looking plan.
        const sealedCount = sealAdminMemberD1ReadMeter(
          meter, prepared.executionInput.callerQueryCount);
        const checkedAtomic = prepareAdminMemberAtomicExecution({
          ...prepared.executionInput, callerQueryCount: sealedCount,
        });
        // Both no-op and write-intent plans must remain internally coherent.
        // This is ONLY a pure replay of validation, never a D1 batch call.
        if ((checkedAtomic === null) !== prepared.assembly.noOp ||
            (checkedAtomic === null) !== (prepared.atomic === null)) {
          throw new RangeError("video_admin_member_dry_run_plan_mismatch");
        }
        // Deliberately discard the sealed plan: no Hono writer/Queue wake.
      },
    } : {}),
    ...(options.enableAtomicCandidateWrite ? {
      commitCanonicalPlan: async (c: Ctx, input: {
        videoId: string;
        target: AdminVideoMemberTarget;
        validated: ValidatedMemberSubmission;
        isCollab: boolean;
        eventIds: readonly string[];
      }) => {
        const meter = activeMeters.get(c);
        const actor = c.get("user");
        const db = c.get("db");
        const settings = c.get("auditSettings");
        const snapshots = c.get("actorSnapshotJsonById");
        const selected = authorizedTargets.get(c);
        if (!guardedContexts.has(c) || !meter || !actor ||
            actor.role !== "admin" || !db || !settings ||
            !snapshots || !snapshots[actor.id] ||
            selected?.videoId !== input.videoId || selected.target !== input.target) {
          throw new RangeError("video_admin_member_candidate_write_not_authorized");
        }
        // Canonical planner can only see the READ-ONLY, metered Drizzle.
        // Every guard/target/member/chapter read is charged BEFORE the handoff.
        const prepared = await prepareAdminVideoMemberCandidateWrite(db, {
          target: input.target,
          videoId: input.videoId,
          actorUserId: actor.id,
          validated: input.validated,
          isCollab: input.isCollab,
          eventIds: input.eventIds,
          now: Math.floor(Date.now() / 1000),
          preloaded: { settings, actorSnapshotJsonById: snapshots },
          readMeasuredCallerQueries: () => meter.readCount(),
        });
        const count = sealAdminMemberD1ReadMeter(
          meter, prepared.executionInput.callerQueryCount,
        );
        const executionInput = { ...prepared.executionInput, callerQueryCount: count };
        // Pure second-pass verification, including the measured 50-query
        // ceiling, before obtaining any provider capable of D1 batch().
        const atomic = prepareAdminMemberAtomicExecution(executionInput);
        if ((atomic === null) !== prepared.assembly.noOp ||
            (atomic === null) !== (prepared.atomic === null)) {
          throw new RangeError("video_admin_member_candidate_write_plan_mismatch");
        }
        if (!atomic) {
          return { committed: false, pendingPublicReflection: false };
        }
        // Only this explicitly enabled unmounted adapter may obtain the raw
        // provider, AFTER its read facade was sealed and the batch validated.
        const writeDb = createAdminMemberAtomicWriteDb(c.env.DB);
        const saved = await executeAdminMemberAtomicCandidate(
          writeDb, executionInput,
          async () => ({
            readEnv: () => {
              try { return c.env as unknown as Readonly<Record<string, unknown>>; }
              catch { return null; }
            },
            readWaitUntil: () => {
              try { const ctx = c.executionCtx; return ctx.waitUntil.bind(ctx); }
              catch { return null; }
            },
            readKv: () => {
              try { return c.env.KV ?? null; }
              catch { return null; }
            },
          }),
          { rebindReadOnlyPlan: true },
        );
        return {
          committed: saved.committed,
          pendingPublicReflection: saved.committed &&
            prepared.assembly.queue.statements.length > 0,
        };
      },
    } : {}),
    writeGuard: async (c, next) => {
      c.header("Cache-Control", "private, no-store");
      const meterState: { meter?: AdminMemberD1ReadMeter } = {};
      const originalEnv = c.env;
      // Lazy DB resolution preserves the existing origin-first denial order:
      // an invalid Origin must never dereference even a failing DB binding.
      const meteredEnv = new Proxy(Object.create(null), {
        get(_facade, key) {
          if (key === "DB") {
            meterState.meter ??= createAdminMemberD1ReadMeter(originalEnv.DB);
            activeMeters.set(c, meterState.meter);
            return meterState.meter.binding;
          }
          return Reflect.get(originalEnv, key, originalEnv);
        },
      }) as AppEnv["Bindings"];
      const guardedContext = new Proxy(c, {
        get(target, key) {
          if (key === "env") return meteredEnv;
          // Hono Context methods may use private fields; bind them to the
          // original Context, not to this request-scoped read-only overlay.
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as Ctx;
      guardedContexts.set(c, guardedContext);
      const execute = async (index: number): Promise<Response | void> => {
        if (index === stack.length) return next();
        let child: Response | void = undefined;
        const result = await stack[index]!(guardedContext, async () => {
          child = await execute(index + 1);
        });
        return result ?? child;
      };
      try {
        return await execute(0);
      } finally {
        // Never permit a retained guard/Drizzle statement to issue late reads.
        meterState.meter?.close();
        activeMeters.delete(c);
        authorizedTargets.delete(c);
        guardedContexts.delete(c);
      }
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
      // MIG-0650 U03ah: do not reject schema-valid draft/limited/archived
      // states before the Hono save host is implemented. Only public triggers
      // the public rebuild fanout in the eventual atomic writer.
      !["draft", "pending", "public", "limited", "private", "archived", "voided"].includes(target.visibility_status) ||
      !Number.isSafeInteger(target.updated_at) || target.updated_at < 0 ||
      // A blank or non-canonical primary ID would become a bogus rebuild
      // target. Apply the same trim/nonempty rule as linked D1 event IDs.
      (target.primary_event_id !== null &&
        (typeof target.primary_event_id !== "string" ||
          !target.primary_event_id ||
          target.primary_event_id.trim() !== target.primary_event_id)) ||
      !Number.isSafeInteger(target.public_member_count) ||
      target.public_member_count < 0 ||
      target.public_member_count > MAX_VIDEO_MEMBERS ||
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

    // Defensive: two distinct host execution modes must never share a
    // request, even if a custom host bypasses the default factory checks.
    if (host.previewCanonicalPlan && host.commitCanonicalPlan) {
      return reject(c, 503, "参加者設定の保存方法を確認できませんでした。");
    }
    // Explicit opt-in dry-run verifies the authenticated Hono -> shared
    // canonical-planner integration with a READ-ONLY metered D1 handle.
    // Regardless of whether a plan is a no-op or would write, NO execution
    // port is wired here. Even a successful preview still returns HTTP 501.
    if (host.previewCanonicalPlan) {
      try {
        await host.previewCanonicalPlan(c, {
          videoId, target, validated: members.value,
          isCollab, eventIds: rebuildEventIds,
        });
      } catch {
        return reject(c, 503, "参加者設定の検証に失敗しました。");
      }
    }
    if (host.commitCanonicalPlan) {
      try {
        const saved = await host.commitCanonicalPlan(c, {
          videoId, target, validated: members.value,
          isCollab, eventIds: rebuildEventIds,
        });
        return c.json({
          ok: true,
          message: saved.committed
            ? "参加者設定を保存しました。"
            : "参加者設定に変更はありません。",
          videoId,
          ...(target.youtube_video_id ? { youtubeVideoId: target.youtube_video_id } : {}),
          ...(target.primary_event_id ? { eventId: target.primary_event_id } : {}),
          ...(saved.pendingPublicReflection ? { pendingPublicReflection: true } : {}),
        }, 200);
      } catch {
        return reject(c, 503, "参加者設定の保存に失敗しました。最新状態を確認して再試行してください。");
      }
    }
    // Default behavior remains HTTP 501: there is still NO live route mount
    // or approved CURRENT >20 MiB input / workerd performance policy.
    return reject(c, 501, "参加者設定の保存APIは移行準備中です。");
  });
  return routes;
}
