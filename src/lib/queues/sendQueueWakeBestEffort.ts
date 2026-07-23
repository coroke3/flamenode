import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/cloudflare";
import { resolveQueueFeatureFlags } from "./featureFlags";
import {
  kindToBindingName,
  type QueueWakeKind,
  type QueueWakeSource,
} from "./wakeBudget";
import {
  assertQueueWakeMessageWithinBudget,
  createQueueWakeMessage,
} from "./wakeMessage";

export type QueueSendBinding = {
  send: (body: unknown) => Promise<void>;
};

type SendQueueWakeOptions = {
  kind: QueueWakeKind;
  source: QueueWakeSource;
  /** 明示 mock（unit test 用）。未指定時は env binding を使う。 */
  queue?: QueueSendBinding | null;
  waitUntil?: (promise: Promise<unknown>) => void;
  /** 同一処理内の重複防止用。呼び出し側が Map を共有する。 */
  sentKinds?: Set<QueueWakeKind>;
  envFlags?: Record<string, string | undefined> | null;
  /** youtube sync だけ別フラグで止められる */
  requireYoutubeFlag?: boolean;
};

const missingBindingWarned = new Set<string>();

function warnOnce(key: string, payload: Record<string, unknown>): void {
  if (missingBindingWarned.has(key)) return;
  missingBindingWarned.add(key);
  console.warn(JSON.stringify(payload));
}

function resolveQueueFromEnv(
  kind: QueueWakeKind,
): QueueSendBinding | null {
  try {
    const env = getEnv() as unknown as Record<string, unknown>;
    const bindingName = kindToBindingName(kind);
    const binding = env[bindingName];
    if (
      binding &&
      typeof binding === "object" &&
      typeof (binding as QueueSendBinding).send === "function"
    ) {
      return binding as QueueSendBinding;
    }
  } catch {
    // binding context が無い場合は Recovery Cron に委ねる
  }
  return null;
}

function resolveWaitUntil(
  explicit?: (promise: Promise<unknown>) => void,
): ((promise: Promise<unknown>) => void) | null {
  if (explicit) return explicit;
  try {
    const ctx = getCloudflareContext();
    const waitUntil = (
      ctx as { ctx?: { waitUntil?: (p: Promise<unknown>) => void } }
    ).ctx?.waitUntil;
    if (typeof waitUntil === "function") return waitUntil.bind(ctx.ctx);
  } catch {
    // ignore
  }
  return null;
}

/**
 * D1 本体保存完了後だけ呼ぶ。Queue 送信失敗は本体成功を壊さない。
 * 同一処理内で同一 kind は最大1回。
 */
export async function sendQueueWakeBestEffort(
  options: SendQueueWakeOptions,
): Promise<{ sent: boolean; reason?: string }> {
  const flags = resolveQueueFeatureFlags(
    options.envFlags ??
      (() => {
        try {
          return getEnv() as unknown as Record<string, string | undefined>;
        } catch {
          return null;
        }
      })(),
  );

  if (!flags.dispatchEnabled) {
    return { sent: false, reason: "dispatch_disabled" };
  }
  if (options.requireYoutubeFlag && !flags.youtubeSyncEnabled) {
    return { sent: false, reason: "youtube_sync_disabled" };
  }
  if (options.source === "continuation" && !flags.continuationEnabled) {
    return { sent: false, reason: "continuation_disabled" };
  }

  if (options.sentKinds?.has(options.kind)) {
    return { sent: false, reason: "duplicate_kind_in_scope" };
  }

  const message = createQueueWakeMessage({
    kind: options.kind,
    source: options.source,
  });
  try {
    assertQueueWakeMessageWithinBudget(message);
  } catch {
    warnOnce(`wake_too_large:${options.kind}`, {
      service: "queue-wake",
      result: "message_too_large",
      kind: options.kind,
    });
    return { sent: false, reason: "message_too_large" };
  }

  const queue = options.queue === undefined
    ? resolveQueueFromEnv(options.kind)
    : options.queue;
  if (!queue) {
    warnOnce(`wake_missing:${options.kind}`, {
      service: "queue-wake",
      result: "binding_missing",
      kind: options.kind,
    });
    return { sent: false, reason: "binding_missing" };
  }

  options.sentKinds?.add(options.kind);

  const sendPromise = queue.send(message).then(
    () => undefined,
    (error: unknown) => {
      warnOnce(`wake_send_failed:${options.kind}`, {
        service: "queue-wake",
        result: "send_failed",
        kind: options.kind,
        error_name: error instanceof Error ? error.name : undefined,
      });
    },
  );

  const waitUntil = resolveWaitUntil(options.waitUntil);
  if (waitUntil) {
    waitUntil(sendPromise);
    return { sent: true };
  }

  await sendPromise;
  return { sent: true };
}

/** テスト用に warning dedupe をリセットする。 */
export function resetQueueWakeWarningStateForTests(): void {
  missingBindingWarned.clear();
}
