import {
  ackAll,
  extractValidatedWakeFromBatch,
  retryAll,
  sendWorkerQueueWakeBestEffort,
  type QueueConsumerResult,
} from "../shared/queueWake.ts";
import { logQueueConsumerFailure } from "../shared/safeLog.ts";
import { processStaticRebuildQueue } from "../json-generator/queue.ts";
import { rebuildEnvironment } from "../shared/rebuildEnvironment.ts";
import type { Env } from "./index.ts";

/**
 * Queue wake 受信時の bounded drain。duplicate wake は1 invocation だけ処理する。
 * outer Cron lease は使わない。
 *
 * stale processing lease のreconcileはRecovery Cronを唯一の定期回復経路にする。
 * 通常wakeごとにreconcile UPDATEを走らせるとD1 write/CPUが増えるため、consumerでは
 * processStaticRebuildQueueへ「reconcile済み相当」を渡して省略する。expired rowは最大1時間
 * Recovery Cronを待つが、pendingの通常処理・continuation wakeには影響しない。
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
    const rebuildEnv = rebuildEnvironment(env);
    const job = await processStaticRebuildQueue(
      rebuildEnv,
      undefined,
      { staleQueueAlreadyReconciled: true },
    );
    result.processed = job.processed ?? 0;
    result.failed = job.failed ?? 0;
    result.skipped = job.skipped ?? 0;

    if (job.hasMore) {
      result.continued = await sendWorkerQueueWakeBestEffort({
        queue: env.STATIC_REBUILD_WAKE_QUEUE,
        kind: "static_rebuild_available",
        source: "continuation",
        envFlags: env as Record<string, string | undefined>,
        kv: env.KV,
      });
    }

    ackAll(messages);
    return result;
  } catch (error) {
    logQueueConsumerFailure({
      service: "flamenode-content-jobs",
      queueKind: "static_rebuild_available",
      messageCount: messages.length,
      error,
    });
    retryAll(messages);
    result.retryBatch = true;
    result.failed = messages.length;
    return result;
  }
}
