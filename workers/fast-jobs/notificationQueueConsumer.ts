import { isTransientDbError } from "../../src/lib/db/transientDbErrorCore.ts";
import {
  hasDuePendingNotifications,
  MAX_NOTIFICATION_BATCH,
  processNotificationQueue,
} from "../notification-dispatcher/dispatch.ts";
import {
  ackAll,
  extractValidatedWakeFromBatch,
  retryAll,
  sendWorkerQueueWakeBestEffort,
} from "../shared/queueWake.ts";

export type NotificationQueueConsumerEnv = {
  DB: D1Database;
  KV?: KVNamespace;
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_BOT_TOKEN?: string;
  APP_ORIGIN?: string;
  NEXT_PUBLIC_APP_URL?: string;
  NOTIFICATION_WAKE_QUEUE?: {
    send: (body: unknown) => Promise<void>;
  };
  QUEUE_DISPATCH_ENABLED?: string;
  QUEUE_CONTINUATION_ENABLED?: string;
};

/**
 * fast-jobs Queue Consumer。batch 内の duplicate wake は1回の drain にまとめる。
 * recoverExpiredLeases は Recovery Cron 側の責務。
 */
export async function handleNotificationWakeQueue(
  batch: MessageBatch<unknown>,
  env: NotificationQueueConsumerEnv,
): Promise<void> {
  const { messages, wake } = extractValidatedWakeFromBatch(
    batch,
    "notification_available",
  );
  if (!wake) {
    ackAll(messages);
    return;
  }

  try {
    await processNotificationQueue(env, {
      limit: MAX_NOTIFICATION_BATCH,
      skipLeaseRecovery: true,
    });

    if (await hasDuePendingNotifications(env)) {
      await sendWorkerQueueWakeBestEffort({
        queue: env.NOTIFICATION_WAKE_QUEUE ?? null,
        kind: "notification_available",
        source: "continuation",
        envFlags: env,
      });
    }

    ackAll(messages);
  } catch (error) {
    if (isTransientDbError(error)) {
      retryAll(messages);
      return;
    }
    ackAll(messages);
  }
}
