import {
  createTraceId,
  logFlowTrace,
  type FlowTraceResult,
} from "@/lib/observability/flowTrace";

export type PostCommitTask = { name: string; run: () => Promise<void> };

export type PostCommitWarning = {
  name: string;
  error_code: string;
  retryable: boolean;
};

export const POST_COMMIT_LOG_KEY = "post_commit";

function errorCodeFrom(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return "UnknownError";
}

function isRetryablePostCommitError(error: unknown): boolean {
  const code = errorCodeFrom(error);
  return code === "TypeError" || code === "FetchError";
}

export async function runPostCommitBestEffort(
  context: { flow: string; traceId?: string },
  tasks: readonly PostCommitTask[],
): Promise<PostCommitWarning[]> {
  const traceId = context.traceId ?? createTraceId();
  const warnings: PostCommitWarning[] = [];

  for (const task of tasks) {
    const startedAt = Date.now();
    logFlowTrace({
      flow: context.flow,
      phase: task.name,
      result: "started",
      trace_id: traceId,
      committed: true,
    });

    try {
      await task.run();
      logFlowTrace({
        flow: context.flow,
        phase: task.name,
        result: "succeeded",
        trace_id: traceId,
        duration_ms: Date.now() - startedAt,
        committed: true,
      });
    } catch (error) {
      const error_code = errorCodeFrom(error);
      const retryable = isRetryablePostCommitError(error);
      warnings.push({ name: task.name, error_code, retryable });
      logFlowTrace({
        flow: context.flow,
        phase: task.name,
        result: "failed" as FlowTraceResult,
        trace_id: traceId,
        duration_ms: Date.now() - startedAt,
        error_code,
        committed: true,
        retryable,
      });
      console.warn(
        JSON.stringify({
          service: POST_COMMIT_LOG_KEY,
          flow: context.flow,
          trace_id: traceId,
          task: task.name,
          error_code,
          retryable,
        }),
      );
    }
  }

  return warnings;
}
