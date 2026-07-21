export interface CronWorkerEnv {
  BUILD_COMMIT_SHA?: string;
}

export interface CronRunContext {
  /** Cloudflare が Cron に割り当てた予定実行時刻（Unix milliseconds）。 */
  scheduledTime: number;
  /** heartbeat 喪失または wall-clock deadline 到達時に中断される。 */
  signal: AbortSignal;
}

export const DEFAULT_CRON_WALL_CLOCK_DEADLINE_MS = 13 * 60 * 1_000;
export const MAX_CRON_WALL_CLOCK_DEADLINE_MS = 15 * 60 * 1_000;

interface CreateCronWorkerOptions<
  Env extends CronWorkerEnv,
> {
  service: string;
  run: (env: Env, context: CronRunContext) => Promise<void>;
  /** 全Cron処理を有限時間で打ち切る。既定13分、最大15分。 */
  wallClockDeadlineMs?: number;
  fetch?: (
    request: Request,
    env: Env,
  ) => Promise<Response>;
}

function boundedDeadlineMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_CRON_WALL_CLOCK_DEADLINE_MS;
  return Math.min(
    MAX_CRON_WALL_CLOCK_DEADLINE_MS,
    Math.max(1, Math.floor(value ?? DEFAULT_CRON_WALL_CLOCK_DEADLINE_MS)),
  );
}

function assertScheduledTime(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("invalid cron scheduledTime");
  }
  return value;
}

async function runWithWallClockDeadline<Env extends CronWorkerEnv>(
  run: (env: Env, context: CronRunContext) => Promise<void>,
  env: Env,
  event: ScheduledEvent,
  deadlineMs: number,
): Promise<void> {
  const controller = new AbortController();
  const deadlineError = new Error(
    `cron wall-clock deadline exceeded: ${deadlineMs}ms`,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(deadlineError);
      reject(deadlineError);
    }, deadlineMs);
  });
  const task = Promise.resolve().then(() =>
    run(env, {
      scheduledTime: assertScheduledTime(event.scheduledTime),
      signal: controller.signal,
    }),
  );

  try {
    await Promise.race([task, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function healthResponse<Env extends CronWorkerEnv>(
  request: Request,
  env: Env,
  service: string,
): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  const headOnly = request.method === "HEAD";
  if (request.method !== "GET" && !headOnly) {
    headers.set("allow", "GET, HEAD");
    return new Response(
      JSON.stringify({ ok: false, service, error: "method_not_allowed" }),
      { status: 405, headers },
    );
  }

  const commit = env.BUILD_COMMIT_SHA?.trim();
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
    return new Response(
      headOnly
        ? null
        : JSON.stringify({
            ok: false,
            service,
            error: "build_commit_unavailable",
          }),
      { status: 503, headers },
    );
  }

  return new Response(
    headOnly
      ? null
      : JSON.stringify({
          ok: true,
          service,
          commit: commit.toLowerCase(),
        }),
    { status: 200, headers },
  );
}

export function createCronWorker<
  Env extends CronWorkerEnv,
>({
  service,
  run,
  wallClockDeadlineMs,
  fetch: customFetch,
}: CreateCronWorkerOptions<Env>) {
  const deadlineMs = boundedDeadlineMs(wallClockDeadlineMs);
  return {
    scheduled(
      event: ScheduledEvent,
      env: Env,
      context: ExecutionContext,
    ): void {
      context.waitUntil(runWithWallClockDeadline(run, env, event, deadlineMs));
    },

    async fetch(
      request: Request,
      env: Env,
    ): Promise<Response> {
      if (
        new URL(request.url).pathname ===
        "/health"
      ) {
        return healthResponse(request, env, service);
      }

      if (customFetch) {
        return customFetch(request, env);
      }

      return new Response("Not Found", {
        status: 404,
      });
    },
  };
}
