import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/cloudflare";
import type { EnvValues, QueueWakeHost } from "@flamenode/server-core/ports";

/**
 * Next / OpenNext side of the server-core ports (D-10). This is the only place that turns
 * getEnv() and getCloudflareContext() into values the framework-free core can use.
 * Every reader may throw outside a request; the core treats that as "unavailable".
 */
export const nextQueueWakeHost: QueueWakeHost = {
  // FlameNodeEnv is an interface and has no index signature, hence the cast.
  readEnv: () => getEnv() as unknown as EnvValues,
  readWaitUntil: () => {
    const ctx = getCloudflareContext();
    const waitUntil = ctx.ctx?.waitUntil;
    return typeof waitUntil === "function" ? waitUntil.bind(ctx.ctx) : null;
  },
  readKv: () => getEnv().KV ?? null,
};
