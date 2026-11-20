/**
 * MIG-0657 U02/U03 (SA-065..068): Slot reserve / release / extend / merge Hono APIs.
 *
 * Mounted under `/api/events` in `apps/api/src/app.ts`. Each POST route uses its own
 * path-scoped write stack (origin -> session -> writeGuard(requiredRole: null) ->
 * costGuard(feature) -> db) so public GET endpoints under `/api/events` never execute
 * session or write guards.
 */
import {
  isSlotOperatorOverrideRequested,
  SlotExtendBodySchema,
  SlotMergeBodySchema,
  SlotReleaseBodySchema,
  SlotReserveBodySchema,
  type SlotMutationResult,
} from "@flamenode/contracts";
import type { WriteFeatureKey } from "@flamenode/domain/admin";
import {
  extendSlotGroupCore,
  mergeSlotGroupsCore,
  releaseSlotCore,
  reserveSlotCore,
  type SlotMutationContext,
  type SlotMutationOutcome,
} from "@flamenode/server-core/slots/reservation";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { sessionMiddleware } from "../../auth/session.ts";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { dbMiddleware } from "../../middleware/db.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../../middleware/writeOrigin.ts";
import {
  auditPreloaded,
  BODY_TOO_LARGE_MESSAGE,
  MAX_ADMIN_JSON_BODY_BYTES,
  readAdminJsonBody,
} from "../admin/body.ts";

const GENERIC_FAILURE_MESSAGE =
  "枠の状態が変更されたか、安全な保存を完了できませんでした。画面を更新してもう一度お試しください。";

function slotWriteStack(
  session: MiddlewareHandler<AppEnv> | undefined,
  feature: WriteFeatureKey,
): MiddlewareHandler<AppEnv> {
  const originOptions = (c: Context<AppEnv>) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL ?? null,
    allowLocalPreview: () => c.env.FLAMENODE_LOCAL_PREVIEW === "1",
  });
  const stack: MiddlewareHandler<AppEnv>[] = [
    (c, next) => originGuardMiddleware(originOptions(c))(c, next),
    session ?? (sessionMiddleware() as unknown as MiddlewareHandler<AppEnv>),
    (c, next) => writeGuardMiddleware({ ...originOptions(c), requiredRole: null })(c, next),
    costGuardMiddleware(feature) as MiddlewareHandler<AppEnv>,
    dbMiddleware,
  ];
  return async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const run = async (index: number): Promise<Response | void> => {
      if (index === stack.length) return next();
      let inner: Response | void = undefined;
      const own = await stack[index]!(c, async () => {
        inner = await run(index + 1);
      });
      return own ?? inner;
    };
    return run(0);
  };
}

function fail(
  c: Context<AppEnv>,
  status: 400 | 413 | 503,
  message: string,
) {
  const body: SlotMutationResult = { ok: false, message };
  return c.json(body, status);
}

function respond(c: Context<AppEnv>, outcome: SlotMutationOutcome) {
  const body: SlotMutationResult = outcome.body;
  return c.json(body, outcome.status);
}

function mutationContext(c: Context<AppEnv>): SlotMutationContext {
  const user = c.get("user")!;
  return {
    authUserId: user.id,
    activeXId: user.active_x_user_id ?? null,
    userRole: user.role ?? null,
    siteUrl: c.env.NEXT_PUBLIC_SITE_URL,
    preloaded: auditPreloaded(c),
  };
}

async function readOptionalJsonBody(
  request: Request,
): Promise<{ kind: "ok"; value: Record<string, unknown> } | { kind: "invalid" } | { kind: "too_large" }> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > MAX_ADMIN_JSON_BODY_BYTES) {
      return { kind: "too_large" };
    }
  }
  if (!request.body) return { kind: "ok", value: {} };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ADMIN_JSON_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { kind: "too_large" };
    }
    chunks.push(value);
  }
  if (total === 0) return { kind: "ok", value: {} };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { kind: "ok", value: parsed as Record<string, unknown> }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

export function createSlotReservationRoutes(
  options: { session?: MiddlewareHandler<AppEnv> } = {},
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post(
    "/:eventId/slots/:slotId/reserve",
    slotWriteStack(options.session, "reserve_slot"),
    async (c) => {
      const eventId = (c.req.param("eventId") ?? "").trim();
      const slotId = (c.req.param("slotId") ?? "").trim();
      if (!eventId || !slotId) return fail(c, 400, "入力エラー");

      const input = await readAdminJsonBody(c.req.raw);
      if (input.kind === "too_large") return fail(c, 413, BODY_TOO_LARGE_MESSAGE);
      if (input.kind !== "ok") return fail(c, 400, "入力エラー");

      const parsed = SlotReserveBodySchema.safeParse(input.value);
      if (!parsed.success) {
        return fail(c, 400, parsed.error.issues[0]?.message ?? "入力エラー");
      }

      try {
        return respond(
          c,
          await reserveSlotCore(c.env.DB, c.get("db"), mutationContext(c), {
            eventId,
            slotId,
            display_name: parsed.data.display_name,
            consecutive_count: parsed.data.consecutive_count,
            operator_override: isSlotOperatorOverrideRequested(parsed.data.operator_override),
          }),
        );
      } catch (error) {
        console.error("[slot-reservation] reserve failed", error instanceof Error ? error.name : "UnknownError");
        return fail(c, 503, GENERIC_FAILURE_MESSAGE);
      }
    },
  );

  routes.post(
    "/:eventId/slots/:slotId/release",
    slotWriteStack(options.session, "release_slot"),
    async (c) => {
      const eventId = (c.req.param("eventId") ?? "").trim();
      const slotId = (c.req.param("slotId") ?? "").trim();
      if (!slotId) return fail(c, 400, "slot_id が必要です。");
      if (!eventId) return fail(c, 400, "入力エラー");

      const input = await readOptionalJsonBody(c.req.raw);
      if (input.kind === "too_large") return fail(c, 413, BODY_TOO_LARGE_MESSAGE);
      if (input.kind !== "ok") return fail(c, 400, "入力エラー");

      const parsed = SlotReleaseBodySchema.safeParse(input.value);
      if (!parsed.success) {
        return fail(c, 400, parsed.error.issues[0]?.message ?? "入力エラー");
      }

      try {
        return respond(
          c,
          await releaseSlotCore(c.env.DB, c.get("db"), mutationContext(c), { eventId, slotId }),
        );
      } catch (error) {
        console.error("[slot-reservation] release failed", error instanceof Error ? error.name : "UnknownError");
        return fail(c, 503, GENERIC_FAILURE_MESSAGE);
      }
    },
  );

  routes.post(
    "/:eventId/slots/:slotId/extend",
    slotWriteStack(options.session, "extend_slot_group"),
    async (c) => {
      const eventId = (c.req.param("eventId") ?? "").trim();
      const slotId = (c.req.param("slotId") ?? "").trim();
      if (!eventId || !slotId) return fail(c, 400, "入力エラー");

      const input = await readAdminJsonBody(c.req.raw);
      if (input.kind === "too_large") return fail(c, 413, BODY_TOO_LARGE_MESSAGE);
      if (input.kind !== "ok") return fail(c, 400, "入力エラー");

      const parsed = SlotExtendBodySchema.safeParse(input.value);
      if (!parsed.success) {
        return fail(c, 400, parsed.error.issues[0]?.message ?? "入力エラー");
      }

      try {
        return respond(
          c,
          await extendSlotGroupCore(c.env.DB, c.get("db"), mutationContext(c), {
            eventId,
            slotId,
            direction: parsed.data.direction,
            operator_override: isSlotOperatorOverrideRequested(parsed.data.operator_override),
          }),
        );
      } catch (error) {
        console.error("[slot-reservation] extend failed", error instanceof Error ? error.name : "UnknownError");
        return fail(c, 503, GENERIC_FAILURE_MESSAGE);
      }
    },
  );

  routes.post(
    "/:eventId/slot-groups/merge",
    slotWriteStack(options.session, "merge_slot_groups"),
    async (c) => {
      const eventId = (c.req.param("eventId") ?? "").trim();
      if (!eventId) return fail(c, 400, "入力エラー");

      const input = await readAdminJsonBody(c.req.raw);
      if (input.kind === "too_large") return fail(c, 413, BODY_TOO_LARGE_MESSAGE);
      if (input.kind !== "ok") return fail(c, 400, "入力エラー");

      const parsed = SlotMergeBodySchema.safeParse(input.value);
      if (!parsed.success) {
        return fail(c, 400, parsed.error.issues[0]?.message ?? "入力エラー");
      }

      try {
        return respond(
          c,
          await mergeSlotGroupsCore(c.env.DB, c.get("db"), mutationContext(c), {
            eventId,
            gap_slot_id: parsed.data.gap_slot_id,
            display_name: parsed.data.display_name,
            operator_override: isSlotOperatorOverrideRequested(parsed.data.operator_override),
          }),
        );
      } catch (error) {
        console.error("[slot-reservation] merge failed", error instanceof Error ? error.name : "UnknownError");
        return fail(c, 503, GENERIC_FAILURE_MESSAGE);
      }
    },
  );

  return routes;
}

export const slotReservationRoutes = createSlotReservationRoutes();
