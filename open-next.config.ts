import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

const cloudflareConfig = defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  // Prime Next.js route modules after the first response so deployment smoke
  // traffic warms shared chunks before later CPU-heavy admin requests. Keep
  // this non-blocking: `onStart` would add every route to cold-start latency.
  routePreloadingBehavior: "withWaitUntil",
});

// OpenNext defaults to `npm run build`. In Workers Builds that must never be
// allowed to re-enter the Cloudflare build pipeline; invoke Next.js directly.
export default {
  ...cloudflareConfig,
  buildCommand: "node node_modules/next/dist/bin/next build",
};
