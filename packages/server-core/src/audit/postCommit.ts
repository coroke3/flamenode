import {
  createTraceId,
  logFlowTrace,
  type FlowTraceResult,
} from "../observability/flowTrace.ts";

export type PostCommitTask = { name: string; run: () => Promise<void> };

export type PostCommitWarning = {
  name: string;
  error_code: string;
  retryable: boolean;
};

export const POST_COMMIT_LOG_KEY = "post_commit";

// Provider/shim Error.name can contain credentials, and even reading it can
// execute a throwing getter. Only fixed, known codes may reach warning/trace.
const SAFE_POST_COMMIT_ERROR_CODES = new Set([
  "Error", "TypeError", "FetchError", "RangeError", "ReferenceError",
  "SyntaxError", "URIError", "EvalError", "AggregateError",
  "AbortError", "TimeoutError", "NetworkError",
]);

function errorCodeFrom(error: unknown): string {
  try {
    if (!(error instanceof Error)) return "UnknownError";
    const name: unknown = error.name;
    return typeof name === "string" && SAFE_POST_COMMIT_ERROR_CODES.has(name)
      ? name
      : "Error";
  } catch {
    // A Proxy getPrototypeOf trap or a poisoned Error.name accessor must not
    // turn a committed mutation into a request failure.
    return "Error";
  }
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
      // Classify once: Error.name can be a stateful or throwing accessor.
      const error_code = errorCodeFrom(error);
      const retryable = error_code === "TypeError" || error_code === "FetchError";
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
      try {
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
      } catch {
        // Diagnostics must never abort the remaining post-commit tasks.
      }
    }
  }

  return warnings;
}
