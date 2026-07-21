/**
 * content-jobs: 15分毎の低負荷コンテンツ更新ジョブ。
 * - static_rebuild_queueをoperation modeにかかわらず最大1件処理
 * - cleanupは1時間に1回だけ実行
 */
import {
  createCronWorker,
  type CronRunContext,
} from "../shared/createCronWorker.ts";
import {
  processStaticRebuildQueue,
} from "../json-generator/queue.ts";
import { withDeduplicatingR2 } from "../json-generator/r2Dedup.ts";
import { runCleanupWithRetry } from "../cleanup/index.ts";
import { withCronLease } from "../shared/cronLease.ts";
import {
  combineJobCounters,
  runJob,
  throwIfJobFailed,
} from "../shared/runJob.ts";
import { withSerializedD1 } from "../shared/serializedD1.ts";
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
const CLEANUP_LEASE_SEC = 10 * 60;

type QueueResult = { processed: number; failed: number; skipped?: number };
type QueueRunner = (env: Env) => Promise<QueueResult>;

function rebuildEnvironment(env: Env): Env {
  return withDeduplicatingR2(withSerializedD1(env));
}

export async function runContentJobs(
  env: Env,
  context: Pick<CronRunContext, "signal"> = { signal: new AbortController().signal },
): Promise<void> {
  await runJob(
    "content-jobs",
    "cron",
    async () => {
      const leased = await withCronLease(
        env,
        {
          jobName: "content-jobs",
          leaseSeconds: CONTENT_JOBS_LEASE_SEC,
          signal: context.signal,
        },
        async (signal) => {
          const rebuild = await runJob(
            "content-jobs",
            "static-rebuild-queue",
            () =>
              processStaticRebuildQueue(
                rebuildEnvironment(env),
                signal,
              ),
            { commitSha: env.BUILD_COMMIT_SHA },
          );
          const cleanupLease = await withCronLease(
            env,
            {
              jobName: "content-jobs:cleanup",
              leaseSeconds: CLEANUP_LEASE_SEC,
              minimumIntervalSeconds: CLEANUP_INTERVAL_SEC,
              signal,
            },
            (cleanupSignal) =>
              runJob(
                "content-jobs",
                "cleanup",
                () => runCleanupWithRetry(env, cleanupSignal),
                { rethrow: true, commitSha: env.BUILD_COMMIT_SHA },
              ),
          );
          const cleanup = cleanupLease.acquired
            ? (cleanupLease.value ?? {})
            : await runJob(
                "content-jobs",
              "cleanup",
              async () => ({ skipped: 1 }),
              { commitSha: env.BUILD_COMMIT_SHA },
            );
          return throwIfJobFailed(
            "content-jobs",
            "cron",
            combineJobCounters(rebuild, cleanup),
          );
        },
      );
      return leased.acquired
        ? (leased.value ?? { skipped: 1 })
        : { skipped: 1 };
    },
    { rethrow: true, commitSha: env.BUILD_COMMIT_SHA },
  );
}

export async function handleContentJobsFetch(
  req: Request,
  env: Env,
  runQueue: QueueRunner = processStaticRebuildQueue,
): Promise<Response> {
  const url = new URL(req.url);
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
        await runJob(
          "content-jobs",
          "manual-static-rebuild",
          async () => {
            queueResult = await runQueue(rebuildEnvironment(env));
            return queueResult;
          },
          { rethrow: true, commitSha: env.BUILD_COMMIT_SHA },
        );
        return queueResult;
      },
    );
  } catch {
    return Response.json(
      { ok: false, error: "rebuild_failed" },
      { status: 500 },
    );
  }
  if (!leaseResult.acquired) {
    return Response.json(
      { ok: false, error: "job_already_running" },
      { status: 409 },
    );
  }
  if (!leaseResult.value) {
    return Response.json(
      { ok: false, error: "rebuild_failed" },
      { status: 500 },
    );
  }
  return Response.json({ ok: true, ...leaseResult.value });
}

export default createCronWorker<Env>({
  service: "flamenode-content-jobs",
  run: runContentJobs,
  fetch: handleContentJobsFetch,
});
