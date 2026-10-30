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

// Optional KV/R2 bindings are best-effort for backfill state and shared-input
// readiness. Accessing a provider binding itself can throw before .get/.head;
// never expose provider details or misreport a committed D1 queue batch as 500.
function getOptionalKvBinding(env: AppEnv["Bindings"]): KVNamespace | undefined {
  try { return env.KV; } catch { return undefined; }
}
function getOptionalBucketBinding(env: AppEnv["Bindings"]): R2Bucket | undefined {
  try { return env.BUCKET; } catch { return undefined; }
}

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

/**
 * Backfill readiness uses only producer-authored R2 HEAD metadata and the
 * tracked D1 hash/generation proof returned in the existing page SELECT.
 * Parsing the 2 MiB/8 MiB bodies in a request violates ZERO_1102 S3.
 * Legacy objects without these proofs fail closed and enqueue regeneration.
 */
type ArtifactProof = { contentHash: string; generatedAt: number };
type SharedProofs = { blocklist: ArtifactProof | null; pool: ArtifactProof | null };
function parseArtifactProof(json: string | null): ArtifactProof | null {
  if (!json || json.length > 512) return null;
  try {
    const raw: unknown = JSON.parse(json);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const contentHash = row.contentHash;
    const generatedAt = row.generatedAt;
    if (typeof contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(contentHash) ||
        typeof generatedAt !== "number" || !Number.isSafeInteger(generatedAt) ||
        generatedAt <= 0) return null;
    return { contentHash, generatedAt };
  } catch { return null; }
}

/** The HEAD is a producer-integrity hint, not a JSON schema validator. */
async function sharedInputsReady(bucket: R2Bucket | undefined, proofs: SharedProofs): Promise<boolean> {
  if (!bucket) return false;
  try {
    for (const [index, [key, maxBytes]] of SHARED_INPUTS.entries()) {
      const proof = index === 0 ? proofs.blocklist : proofs.pool;
      if (!proof) return false;
      // Exact keys are audited in the MIG-0649 R2 artifact consumer registry.
      const obj = key === "youtube/related-blocklist.v1.json"
        ? await bucket.head("youtube/related-blocklist.v1.json")
        : await bucket.head("videos/random-pool.v1.json");
      if (!obj || !Number.isSafeInteger(obj.size) || obj.size < 0 || obj.size > maxBytes) return false;
      const meta = obj.customMetadata;
      if (meta?.schema_version !== "1" ||
          meta.content_hash !== proof.contentHash ||
          typeof meta.source_generation !== "string" ||
          meta.source_generation.trim().length === 0 ||
          meta.source_generation.length > 128) return false;
    }
    return true;
  } catch {
    // Missing R2 binding, HEAD error or incomplete producer metadata: treat
    // both inputs as unavailable, keeping the existing shared-input repair.
    return false;
  }
}

type BackfillPage = {
  total: number;
  ids_json: string;
  blocklist_proof_json: string | null;
  pool_proof_json: string | null;
};
/** One DB call: total count, next 13 IDs, and (video-only) producer proofs. */
async function loadBackfillPage(db: D1Database, kind: StaticBackfillKind, cursor: string) {
  const selection = kind === "video_v2"
    ? { table: "videos", condition: "visibility_status = 'public'" }
    : kind === "user_profile"
      ? { table: "x_users", condition: "approval_status IN ('approved','pending','imported')" }
      : { table: "events", condition: "visibility_status = 'public'" };
  // Closed constants only. The additional two scalar lookup expressions use
  // static_artifacts' live target/key indexes and no extra D1 statement.
  const proofsSql = kind === "video_v2" ? `
      (SELECT json_object('contentHash', content_hash, 'generatedAt', generated_at)
       FROM static_artifacts
       WHERE target_type = 'youtube_related_blocklist'
         AND target_id = 'global' AND object_key = 'youtube/related-blocklist.v1.json'
         AND deleted_at IS NULL LIMIT 1) AS blocklist_proof_json,
      (SELECT json_object('contentHash', content_hash, 'generatedAt', generated_at)
       FROM static_artifacts
       WHERE target_type = 'random_video_pool'
         AND target_id = 'global' AND object_key = 'videos/random-pool.v1.json'
         AND deleted_at IS NULL LIMIT 1) AS pool_proof_json`
    : "NULL AS blocklist_proof_json, NULL AS pool_proof_json";
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM ${selection.table} WHERE ${selection.condition}) AS total,
      (SELECT json_group_array(id) FROM
        (SELECT id FROM ${selection.table}
         WHERE ${selection.condition} AND id > ?
         ORDER BY id ASC LIMIT ${BATCH_SIZE + 1})) AS ids_json,
      ${proofsSql}
  `).bind(cursor).first<BackfillPage>();
  const ids = row?.ids_json ? JSON.parse(row.ids_json) as unknown : [];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new Error("invalid_backfill_page");
  }
  return {
    total: Math.max(0, Number(row?.total ?? 0)),
    selected: ids as string[],
    proofs: {
      blocklist: parseArtifactProof(row?.blocklist_proof_json ?? null),
      pool: parseArtifactProof(row?.pool_proof_json ?? null),
    },
  };
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
  const kv = getOptionalKvBinding(c.env);
  const state = await readBackfillState(kv);
  const previous = state.runs[kind];
  const cursor = restart ? "" : requestedCursor || previous.cursor || "";
  const now = Math.floor(Date.now() / 1000);
  const baseScanned = restart ? 0 : previous.scanned;
  const baseEnqueued = restart ? 0 : previous.enqueued;

  const reply = async (run: StaticBackfillRunState, scanned: number, enqueued: number) => {
    const persisted = await writeBackfillState(kv, withStaticBackfillRun(state, kind, run, now));
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
    const { total, selected, proofs } = await loadBackfillPage(c.env.DB, kind, cursor);

    if (kind === "video_v2" && !await sharedInputsReady(getOptionalBucketBinding(c.env), proofs)) {
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
  } catch {
    // D1/provider exceptions may contain query text, identifiers or credentials.
    // Never persist their raw messages to KV or reflect them through an API.
    // A fixed diagnostic preserves the CURRENT failed-state/retry contract.
    const message = "バックフィル処理に失敗しました。状態を確認して再試行してください。";
    const failed: StaticBackfillRunState = {
      ...previous, status: "failed", last_error: message, last_run_at: now,
    };
    const persisted = await writeBackfillState(kv, withStaticBackfillRun(state, kind, failed, now));
    return c.json({
      backfill_kind: kind, backfill_error: message,
      backfill_state_persisted: persisted ? "1" : "0",
    }, 500);
  }
});
