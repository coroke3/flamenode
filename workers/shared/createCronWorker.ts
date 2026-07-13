export interface CronWorkerEnv {
  BUILD_COMMIT_SHA?: string;
}

interface CreateCronWorkerOptions<
  Env extends CronWorkerEnv,
> {
  service: string;
  run: (
    env: Env,
    event: ScheduledEvent,
  ) => Promise<void>;
  fetch?: (
    request: Request,
    env: Env,
  ) => Promise<Response>;
}

export function createCronWorker<
  Env extends CronWorkerEnv,
>({
  service,
  run,
  fetch: customFetch,
}: CreateCronWorkerOptions<Env>) {
  return {
    scheduled(
      event: ScheduledEvent,
      env: Env,
      context: ExecutionContext,
    ): void {
      context.waitUntil(run(env, event));
    },

    async fetch(
      request: Request,
      env: Env,
    ): Promise<Response> {
      if (
        new URL(request.url).pathname ===
        "/health"
      ) {
        return Response.json({
          ok: true,
          service,
          commit:
            env.BUILD_COMMIT_SHA ??
            "unknown",
        });
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
