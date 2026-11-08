/**
 * MIG-0656 U03p: SA-058 bounded Hono generated-slot chunk, UNMOUNTED.
 * NOT an entire 100-row operation, a resume-token protocol or a ready API.
 * Future parent must supply Origin -> Auth.js session -> TOS/writeGuard -> DB;
 * candidate enforces CostGuard + scoped event.slots permission.
 * One preread plus one strict-audited D1 batch containing the collision
 * assertion, <=3 INSERTs and static projections; no direct Queue wake.
 */
import { Hono } from "hono";
import { SlotGenerateBodySchema } from "@flamenode/contracts";
import { generateId } from "@flamenode/server-core/id";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { buildSlotChangeQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import type { AppEnv } from "../../env.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { auditPreloaded, BODY_TOO_LARGE_MESSAGE, readAdminJsonBody } from "../admin/body.ts";
import { canUpdateEventLabels } from "./slotWriteScopedRead.ts";
import { planGeneratedSlots, materializeGeneratedSlotRows } from "./slotWritePlanning.ts";
import { buildGeneratedSlotChunkAtomicPlan, MAX_GENERATE_SLOT_CHUNK_ROWS } from "./slotGeneratedChunkMutation.ts";
import { isWriteConflict } from "../events/templates.ts";

const NO_STORE = "private, no-store";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const WRITE_FAILED = "枠の生成に失敗しました。再読み込み後にお試しください。";

/** No slot rows read: only event existence and 101-row permission sentinel. */
export const SLOT_GENERATE_CHUNK_SCOPE_SQL = `
SELECT
  (SELECT id FROM events WHERE id = ? LIMIT 1) AS exists_id,
  (SELECT json_group_array(json_object(
    'permission_preset', staff.permission_preset,
    'custom_permission_keys_json', staff.custom_permission_keys_json
  )) FROM (
    SELECT es.permission_preset, es.custom_permission_keys_json
    FROM event_staff es
    JOIN x_user_account_links l ON l.x_user_id = es.x_user_id
    JOIN x_users x ON x.id = l.x_user_id
    WHERE es.event_id = ? AND l.auth_user_id = ?
      AND x.approval_status = 'approved'
    LIMIT 101
  ) staff) AS staff_json
`;

type ScopeRead = { exists_id: string | null; staff_json: string | null };

/** Deliberately NOT imported or mounted in manage/index.ts. */
export const slotGeneratedChunkRoutes = new Hono<AppEnv>();
slotGeneratedChunkRoutes.use("*", costGuardMiddleware("manage_slot_create"));
slotGeneratedChunkRoutes.post("/generate-chunk", async (c) => {
  c.header("Cache-Control", NO_STORE);
  const user = c.get("user");
  if (!user) return c.json({ ok: false, message: "ログインが必要です。" }, 401);
  const eventId = c.req.param("id") ?? "";
  if (!ID_PATTERN.test(eventId)) {
    return c.json({ ok: false, message: "イベントIDが不正です。" }, 400);
  }
  const body = await readAdminJsonBody(c.req.raw);
  if (body.kind === "too_large") return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  if (body.kind !== "ok") return c.json({ ok: false, message: "入力エラー" }, 400);
  const parsed = SlotGenerateBodySchema.safeParse(body.value);
  if (!parsed.success) return c.json({ ok: false, message: "入力エラー" }, 400);
  const generated = planGeneratedSlots(parsed.data);
  if (!generated.ok) return c.json({ ok: false, message: generated.message }, 400);
  if (generated.candidates.length > MAX_GENERATE_SLOT_CHUNK_ROWS) {
    // Do NOT silently insert the first three of an up-to-100 row request.
    return c.json({ ok: false, message: "1リクエストで生成できる枠は3件までです。" }, 409);
  }
  const db = c.get("db");
  if (!db || !c.get("auditSettings") || !c.get("actorSnapshotJsonById")) {
    return c.json({ ok: false, message: WRITE_FAILED }, 503);
  }
  try {
    const scope = await c.env.DB.prepare(SLOT_GENERATE_CHUNK_SCOPE_SQL)
      .bind(eventId, eventId, user.id).first<ScopeRead>();
    if (!scope) return c.json({ ok: false, message: WRITE_FAILED }, 503);
    if (!canUpdateEventLabels(user.role, scope.staff_json) || !scope.exists_id) {
      return c.json({ ok: false, message: "Not Found" }, 404);
    }
    const now = Math.floor(Date.now() / 1000);
    const rows = materializeGeneratedSlotRows(
      eventId, generated.candidates, now, () => generateId("slot"),
    );
    const plan = buildGeneratedSlotChunkAtomicPlan({
      eventId, mode: parsed.data.mode, rows,
    });
    const queue = await buildSlotChangeQueueBatch(db, {
      eventId, reason: "slot_admin_generate", requestedByUserId: user.id,
    });
    await mutateWithAudit(db, {
      preMutationAssertions: plan.preMutationAssertions.map((item) => db.run(item)),
      mutationStatements: [db.run(plan.mutationStatement), ...queue.statements],
      expectedMutationChanges: [plan.expectedMutationChanges, ...queue.expectedChanges],
      audits: rows.map((row) => ({
        table_name: "slots" as const,
        target_id: row.id,
        operation: "CREATE" as const,
        after: { ...row },
        actor_user_id: user.id,
        retention_class: "normal" as const,
        strict: true,
      })),
      preloaded: auditPreloaded(c),
    });
    return c.json({
      ok: true, createdThisChunk: plan.processedCount,
      // No request/operation ID is recorded; never declare 100-row completion.
      completionVerified: false,
      pendingPublicReflection: queue.statements.length > 0,
    }, 200);
  } catch (error) {
    console.error("[MIG-0656] SA-058 generated chunk failed");
    return c.json({ ok: false, message: WRITE_FAILED }, isWriteConflict(error) ? 409 : 503);
  }
});
