// Compatibility bridge (MIG-0613, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import { nextQueueWakeHost } from "@/lib/serverCore/nextPorts";
import {
  sendQueueWakeBestEffort as sendQueueWakeBestEffortCore,
  type SendQueueWakeOptions,
} from "@flamenode/server-core/queues/sendQueueWakeBestEffort";

export {
  resetQueueWakeWarningStateForTests,
  type QueueSendBinding,
  type SendQueueWakeOptions,
} from "@flamenode/server-core/queues/sendQueueWakeBestEffort";

export function sendQueueWakeBestEffort(
  options: SendQueueWakeOptions,
): Promise<{ sent: boolean; reason?: string }> {
  return sendQueueWakeBestEffortCore(options, nextQueueWakeHost);
}
