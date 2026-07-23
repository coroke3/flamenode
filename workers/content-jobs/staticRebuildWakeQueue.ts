import { isTransientDbError } from "../../src/lib/db/transientDbErrorCore.ts";
import {
  ackAll,
  extractValidatedWakeFromBatch,
  retryAll,
  sendWorkerQueueWakeBestEffort,
  type QueueConsumerResult,
} from "../shared/queueWake.ts";
import { processStaticRebuildQueue } from "../json-generator/queue.ts";
import { withDeduplicatingR2 } from "../json-generator/r2Dedup.ts";
import { withSerializedD1 } from "../shared/serializedD1.ts";
import type { Env } from "./index.ts";

function rebuildEnvironment(env: Env): Env {
  return withDeduplicatingR2(withSerializedD1(env));
}

/**
 * Queue wake 受信時の bounded drain。duplicate wake は1 invocation だけ処理する。
 * outer Cron lease は使わない。
 */
export async function handleStaticRebuildWakeQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<QueueConsumerResult> {
  const { messages, wake } = extractValidatedWakeFromBatch(
    batch,
    "static_rebuild_available",
  );
  const result: QueueConsumerResult = {
    retryBatch: false,
    continued: false,
    processed: 0,
    skipped: 0,
    failed: 0,
  };

  if (!wake) {
    ackAll(messages);
    return result;
  }

  try {
    const job = await processStaticRebuildQueue(rebuildEnvironment(env));
    result.processed = job.processed ?? 0;
    result.failed = job.failed ?? 0;
    result.skipped = job.skipped ?? 0;

    if (job.hasMore) {
      result.continued = await sendWorkerQueueWakeBestEffort({
        queue: env.STATIC_REBUILD_WAKE_QUEUE,
        kind: "static_rebuild_available",
        source: "continuation",
        envFlags: env as Record<string, string | undefined>,
      });
    }

    ackAll(messages);
    return result;
  } catch (error) {
    if (isTransientDbError(error)) {
      retryAll(messages);
      result.retryBatch = true;
      return result;
    }
    ackAll(messages);
    return result;
  }
}
