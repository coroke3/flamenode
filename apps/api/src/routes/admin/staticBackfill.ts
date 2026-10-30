/**
 * MIG-0643 U02 SA-069: bounded static JSON backfill, UNMOUNTED.
 * Parent /api/admin origin + session + writeGuard is owned by PR #472.
 * One D1 count+page query and one atomic queue/audit batch per request; KV
 * state is best-effort as in CURRENT; no production R2 writes or Queue sends.
 */
import { Hono } from "hono";
import { AdminStaticBackfillBodySchema } from "@flamenode/contracts/admin/staticRebuildOps";
import {
  createEmptyStaticBackfillState,
  parseStaticBackfillState,
  withStaticBackfillRun,
  STATIC_BACKFILL_KV_KEY,
  type StaticBackfillKind,
  type StaticBackfillRunState,
} from "@flamenode/domain/admin";
import { buildStaticRebuildQueueBatch } from "@flamenode/server-core/staticRebuild/enqueue";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import type { AppEnv } from "../../env.ts";
import { auditPreloaded, readAdminJsonBody, BODY_TOO_LARGE_MESSAGE } from "./body.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";

const BATCH_SIZE = 12;
const SHARED_INPUTS = [
  ["youtube/related-blocklist.v1.json", 2 * 1024 * 1024],
  ["videos/random-pool.v1.json", 8 * 1024 * 1024],
] as const;

/** CURRENT: KV read failures yield fresh state, KV writes are best-effort. */
async function readBackfillState(kv: KVNamespace | undefined) {
  if (!kv) return createEmptyStaticBackfillState();
  try {
    const raw = await kv.get(STATIC_BACKFILL_KV_KEY);
    return raw ? parseStaticBackfillState(JSON.parse(raw)) : createEmptyStaticBackfillState();
  } catch {
    return createEmptyStaticBackfillState();
  }
}
async function writeBackfillState(kv: KVNamespace | undefined, state: ReturnType<typeof createEmptyStaticBackfillState>) {
  if (!kv) return false;
  try {
    await kv.put(STATIC_BACKFILL_KV_KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}

/** CURRENT needs both R2 shared objects, with generated_at and generation_key. */
async function sharedInputsReady(bucket: R2Bucket | undefined): Promise<boolean> {
  if (!bucket) return false;
  const values: unknown[] = [];
  // CURRENT loadStaticJsonFreshStaleUnavailable reports R2 exceptions as
  // unavailable, which schedules both shared targets rather than failing the
  // backfill. Only the later D1 queue failure should mark the run failed.
  try {
    for (const [key, maxBytes] of SHARED_INPUTS) {
      // Key literals are part of the audited MIG-0649 R2 consumer registry.
      const obj = key === "youtube/related-blocklist.v1.json"
        ? await bucket.get("youtube/related-blocklist.v1.json")
        : await bucket.get("videos/random-pool.v1.json");
      if (!obj) return false;
      // Align R2 size bounds with server-core/readBoundedR2Json: a
      // negative, fractional or unsafe integer size is not a trusted length.
      if (!Number.isSafeInteger(obj.size) || obj.size < 0 || obj.size > maxBytes) {
        await obj.body?.cancel().catch(() => undefined);
        return false;
      }
      const text = await obj.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) return false;
      try {
        values.push(JSON.parse(text));
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
  const block = values[0] as Record<string, unknown> | null;
  const pool = values[1] as Record<string, unknown> | null;
  const plainObject = (x: unknown): x is Record<string, unknown> =>
    x !== null && typeof x === "object" && !Array.isArray(x);
  // Match CURRENT normalizeYoutubeRelatedBlocklist / normalizeRandomVideoPool:
  // Number("Infinity") must never count as a valid generated_at. Invalid
  // shared inputs should enqueue regeneration, not advance video backfill.
  const validGeneratedAt = (value: unknown): boolean => {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0;
  };
  return plainObject(block) && Number(block.schema_version) === 1 &&
    validGeneratedAt(block.generated_at) && plainObject(block.blocked) &&
    plainObject(pool) && Number(pool.schema_version) === 1 &&
    validGeneratedAt(pool.generated_at) && Array.isArray(pool.items) &&
    typeof pool.generation_key === "string" && pool.generation_key.trim().length > 0;
}

type BackfillPage = { total: number; ids_json: string };
/** One DB call: total count and next 13 IDs in deterministic CURRENT order. */
async function loadBackfillPage(db: D1Database, kind: StaticBackfillKind, cursor: string) {
  const selection = kind === "video_v2"
    ? { table: "videos", condition: "visibility_status = 'public'" }
    : kind === "user_profile"
      ? { table: "x_users", condition: "approval_status IN ('approved','pending','imported')" }
      : { table: "events", condition: "visibility_status = 'public'" };
  // Both identifiers and predicate are closed literal constants, never user input.
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM ${selection.table} WHERE ${selection.condition}) AS total,
      (SELECT json_group_array(id) FROM
        (SELECT id FROM ${selection.table}
         WHERE ${selection.condition} AND id > ?
         ORDER BY id ASC LIMIT ${BATCH_SIZE + 1})) AS ids_json
  `).bind(cursor).first<BackfillPage>();
  const ids = row?.ids_json ? JSON.parse(row.ids_json) as unknown : [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new Error("invalid_backfill_page");
  }
  return { total: Math.max(0, Number(row?.total ?? 0)), selected: ids as string[] };
}

async function queueBackfill(
  c: import("hono").Context<AppEnv>,
  targets: Parameters<typeof buildStaticRebuildQueueBatch>[1],
  targetId: string,
  after: Record<string, unknown>,
  reason: string,
) {
  const batch = await buildStaticRebuildQueueBatch(c.get("db"), targets);
  if (batch.statements.length) {
    await mutateWithAudit(c.get("db"), {
      mutationStatements: batch.statements,
      expectedMutationChanges: batch.expectedChanges,
      preloaded: auditPreloaded(c),
      audits: [{
        table_name: "static_rebuild_queue", target_id: targetId,
        // Match CURRENT enqueueBackfillRows: the audit records the number
        // of targets accepted by the queue builder, not the input page size.
        operation: "CREATE",
        after: "accepted_targets" in after
          ? { ...after, accepted_targets: batch.acceptedTargetCount }
          : after,
        actor_user_id: c.get("user")!.id,
        context: "admin_static_backfill", reason, retention_class: "normal", strict: true,
      }],
    });
  }
  return batch.acceptedTargetCount;
}

export const staticBackfillAdminRoutes = new Hono<AppEnv>();
staticBackfillAdminRoutes.use("*", onlyMutating(costGuardMiddleware("admin_static_rebuild")));

staticBackfillAdminRoutes.post("/", async (c) => {
  const raw = await readAdminJsonBody(c.req.raw);
  if (raw.kind === "too_large") return c.json({ ok: false, message: BODY_TOO_LARGE_MESSAGE }, 413);
  const parsed = raw.kind === "ok" ? AdminStaticBackfillBodySchema.safeParse(raw.value) : null;
  if (!parsed?.success) return c.json({ ok: false, message: "入力内容を確認してください。" }, 400);

  const { kind, mode, cursor: requestedCursor } = parsed.data;
  const restart = mode === "restart";
  const state = await readBackfillState(c.env.KV);
  const previous = state.runs[kind];
  const cursor = restart ? "" : requestedCursor || previous.cursor || "";
  const now = Math.floor(Date.now() / 1000);
  const baseScanned = restart ? 0 : previous.scanned;
  const baseEnqueued = restart ? 0 : previous.enqueued;

  const reply = async (run: StaticBackfillRunState, scanned: number, enqueued: number) => {
    const persisted = await writeBackfillState(c.env.KV, withStaticBackfillRun(state, kind, run, now));
    return c.json({
      backfill_kind: kind,
      backfill_scanned: String(scanned),
      backfill_enqueued: String(enqueued),
      backfill_done: run.status === "completed" ? "1" : "0",
      backfill_state_persisted: persisted ? "1" : "0",
      ...(run.cursor ? { backfill_cursor: run.cursor } : {}),
    }, 200);
  };

  try {
    const { total, selected } = await loadBackfillPage(c.env.DB, kind, cursor);

    if (kind === "video_v2" && !await sharedInputsReady(c.env.BUCKET)) {
      await queueBackfill(c, [
        { targetType: "youtube_related_blocklist", targetId: "global", reason: "backfill_video_v2_shared_inputs", priority: "high", requestedByUserId: c.get("user")!.id },
        { targetType: "random_video_pool", targetId: "global", reason: "backfill_video_v2_shared_inputs", priority: "high", requestedByUserId: c.get("user")!.id },
      ], "backfill:video_v2:shared-inputs", { targets: ["youtube_related_blocklist", "random_video_pool"] }, "動画バックフィル用共有JSON準備");
      return reply({
        cursor: restart ? null : cursor || previous.cursor,
        phase: "shared_inputs", status: "running",
        total, scanned: baseScanned, enqueued: baseEnqueued,
        last_error: null, last_run_at: now,
      }, 0, 0);
    }

    const batch = selected.slice(0, BATCH_SIZE);
    if (!batch.length) {
      return reply({
        cursor: null, phase: "items", status: "completed",
        total, scanned: Math.max(baseScanned, total), enqueued: baseEnqueued,
        last_error: null, last_run_at: now,
      }, 0, 0);
    }

    const hasMore = selected.length > BATCH_SIZE;
    const targetType = kind === "video_v2" ? "video" : kind === "user_profile" ? "user" : "event";
    const accepted = await queueBackfill(c, batch.map((row) => ({
      targetType, targetId: row, reason: `backfill_${kind}`,
      priority: "low", requestedByUserId: c.get("user")!.id,
    })), `backfill:${kind}:${batch[0]}`, {
      kind, scanned: batch.length, accepted_targets: batch.length,
      cursor: cursor || null, next_cursor: hasMore ? batch.at(-1) ?? null : null,
    }, "静的JSON段階的バックフィル");
    return reply({
      cursor: hasMore ? batch.at(-1) ?? null : null,
      phase: "items", status: hasMore ? "running" : "completed",
      total, scanned: baseScanned + batch.length, enqueued: baseEnqueued + accepted,
      last_error: null, last_run_at: now,
    }, batch.length, accepted);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed: StaticBackfillRunState = {
      ...previous, status: "failed", last_error: message.slice(0, 1000), last_run_at: now,
    };
    const persisted = await writeBackfillState(c.env.KV, withStaticBackfillRun(state, kind, failed, now));
    return c.json({
      backfill_kind: kind, backfill_error: message.slice(0, 240),
      backfill_state_persisted: persisted ? "1" : "0",
    }, 500);
  }
});
