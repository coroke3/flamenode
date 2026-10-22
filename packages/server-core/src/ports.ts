/**
 * Everything the server core needs from its host (Next via nextPorts.ts, Hono via c.env).
 * The core never reads process.env, getCloudflareContext() or any request context itself
 * (scripts/check-server-core-boundaries.mjs). Types are structural so Cloudflare's
 * D1/KV/R2/Queue/Cache bindings satisfy them without importing workers-types.
 */

/** Flag and binding values the host has already resolved (e.g. QUEUE_DISPATCH_ENABLED). */
export type EnvValues = Readonly<Record<string, unknown>>;

/** A Queue producer binding. Only used after the D1 batch has committed. */
export type QueueWakePort = {
  send(body: unknown): Promise<void>;
};

/** `ctx.waitUntil`. Hosts without one pass `null` where a port is optional and the core awaits instead. */
export type WaitUntilPort = (promise: Promise<unknown>) => void;

/** KV subset used for diagnostics and the visibility fence. */
export type KvPort = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

/** R2 subset used for pre-generated artifacts and fence manifests. */
export type BucketPort = {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
};

/** Cache API subset used to drop stale public responses. */
export type EdgeCachePort = {
  delete(url: string): Promise<boolean>;
};

/**
 * Re-throws framework control-flow errors (Next redirect/notFound) that must not be swallowed
 * by best-effort catch blocks. Next supplies `unstable_rethrow`; Hono supplies a no-op.
 */
export type RethrowFrameworkControl = (error: unknown) => void;

/** Injected time source for code that must be deterministic in tests. */
export type Clock = {
  nowMs(): number;
};

/**
 * What the Queue wake chain needs from its host. Each reader returns null (or throws, which the
 * core treats as null) when the host has no binding context; wake is best-effort and never
 * fails the committed mutation. Next supplies these from getCloudflareContext in nextPorts.ts,
 * Hono from `c.env` and `c.executionCtx`.
 */
export type QueueWakeHost = {
  /** Resolved env: feature flags (QUEUE_DISPATCH_ENABLED ...) and queue bindings by binding name. */
  readEnv(): EnvValues | null;
  /** `ctx.waitUntil` of the current request. */
  readWaitUntil(): WaitUntilPort | null;
  /** KV used to record the last wake failure. */
  readKv(): Pick<KvPort, "put"> | null;
};

/**
 * Resolves the host after the D1 batch has committed. Next loads nextPorts.ts lazily, so code
 * that never wakes a Queue (and tests that do not mock server-only) never evaluates it.
 */
export type QueueWakeHostLoader = () => Promise<QueueWakeHost>;
