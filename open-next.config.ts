import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import { withRegionalCache } from "@opennextjs/cloudflare/overrides/incremental-cache/regional-cache";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";

const cloudflareConfig = defineCloudflareConfig({
  incrementalCache: withRegionalCache(r2IncrementalCache, { mode: "short-lived" }),
  queue: memoryQueue,
  // Load route modules only when requested. Background all-route preloading can
  // race later cold-start requests after OpenNext marks routes as loaded, while
  // also spending Cloudflare free-tier CPU on routes that may never be used.
  routePreloadingBehavior: "none",
});

// OpenNext defaults to `npm run build`. In Workers Builds that must never be
// allowed to re-enter the Cloudflare build pipeline; invoke Next.js directly.
export default {
  ...cloudflareConfig,
  buildCommand: "node node_modules/next/dist/bin/next build",
};