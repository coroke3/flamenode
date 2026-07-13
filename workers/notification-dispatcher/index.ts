/**
 * 旧 notification-dispatcher は deploy 対象ではない。
 * 副作用を持つ fetch handler を残さず、fast-jobs から使う実装だけを公開する。
 */
export {
  deliver,
  processNotificationQueue,
  MAX_DISCORD_DM_KV_WRITES_PER_RUN,
  MAX_DISCORD_EXTERNAL_REQUESTS_PER_RUN,
  MAX_NOTIFICATION_BATCH,
} from "./dispatch.ts";
export type { Env } from "./dispatch.ts";
