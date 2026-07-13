/**
 * content-jobs: 15分毎の低負荷コンテンツ更新ジョブ。
 * - static_rebuild_queueを通常最大3件、economy最大1件処理
 * - cleanupは1時間に1回だけ実行
 */
import { processStaticRebuildQueue } from "../json-generator/queue.ts";
import { runCleanupWithRetry } from "../cleanup/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import { runJob } from "../shared/runJob.ts";
import { rejectUnauthorizedWorkerRequest } from "../shared/workerAdminAuth.ts";

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
  WORKER_ADMIN_TOKEN?: string;
  BUILD_COMMIT_SHA?: string;
}

const CLEANUP_INTERVAL_SEC = 3600;
const CONTENT_JOBS_LEASE_SEC = 14 * 60;

type QueueResult = { processed: number; failed: number; skipped?: number };
type QueueRunner = (env: Env) => Promise<QueueResult>;

export async function runContentJobs(env: Env): Promise<void> {
  await runJob("content-jobs", "cron", async () => {
    const leased = await withCronLease(
      env,
      { jobName: "content-jobs", leaseSeconds: CONTENT_JOBS_LEASE_SEC },
      async () => {
        let processed = 0;
        let skipped = 0;
        let failed = 0;

        const rebuild = await runJob("content-jobs", "static-rebuild-queue", () =>
          processStaticRebuildQueue(env),
        );
        processed += rebuild.processed;
        skipped += rebuild.skipped;
        failed += rebuild.failed;

        const lastCleanup = await env.KV.get("content-jobs:cleanup:last_run");
        const now = Math.floor(Date.now() / 1000);
        if (!lastCleanup || now - Number(lastCleanup) > CLEANUP_INTERVAL_SEC) {
          const cleanup = await runJob("content-jobs", "cleanup", () =>
            runCleanupWithRetry(env),
          );
          processed += cleanup.processed;
          skipped += cleanup.skipped;
          failed += cleanup.failed;
          if (cleanup.succeeded && cleanup.failed === 0) {
            await env.KV.put("content-jobs:cleanup:last_run", String(now), {
              expirationTtl: 7200,
            });
          }
        } else {
          skipped += 1;
          await runJob("content-jobs", "cleanup", async () => ({ skipped: 1 }));
        }

        return { processed, skipped, failed };
      },
    );
    return leased.acquired ? (leased.value ?? { skipped: 1 }) : { skipped: 1 };
  });
}

export async function handleContentJobsFetch(
  req: Request,
  env: Env,
  runQueue: QueueRunner = processStaticRebuildQueue,
): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/health") {
    return Response.json({
      ok: true,
      service: "content-jobs",
      commit:
        env.BUILD_COMMIT_SHA ?? "unknown",
    });
  }
  if (url.pathname !== "/rebuild" && url.pathname !== "/process-queue") {
    return new Response("Not Found", { status: 404 });
  }

  const rejected = rejectUnauthorizedWorkerRequest(req, env);
  if (rejected) return rejected;

  let queueResult: QueueResult | undefined;
  let leaseResult: { acquired: boolean; value?: QueueResult };
  try {
    leaseResult = await withCronLease(
      env,
      { jobName: "content-jobs", leaseSeconds: CONTENT_JOBS_LEASE_SEC },
      async () => {
        const run = await runJob("content-jobs", "manual-static-rebuild", async () => {
          queueResult = await runQueue(env);
          return queueResult;
        });
        if (!run.succeeded) throw new Error("manual static rebuild failed");
        return queueResult;
      },
    );
  } catch {
    return Response.json({ ok: false, error: "rebuild_failed" }, { status: 500 });
  }
  if (!leaseResult.acquired) {
    return Response.json({ ok: false, error: "job_already_running" }, { status: 409 });
  }
  if (!leaseResult.value) {
    return Response.json({ ok: false, error: "rebuild_failed" }, { status: 500 });
  }
  return Response.json({ ok: true, ...leaseResult.value });
}

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runContentJobs(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    return handleContentJobsFetch(req, env);
  },
};
