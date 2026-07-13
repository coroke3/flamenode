export interface CronWorkerEnv {
  BUILD_COMMIT_SHA?: string;
}

interface CreateCronWorkerOptions<
  Env extends CronWorkerEnv,
> {
  service: string;
  run: (env: Env) => Promise<void>;
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
      _event: ScheduledEvent,
      env: Env,
      context: ExecutionContext,
    ): void {
      context.waitUntil(run(env));
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
