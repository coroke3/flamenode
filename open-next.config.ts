import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

const cloudflareConfig = defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});

// OpenNext defaults to `npm run build`. In Workers Builds that must never be
// allowed to re-enter the Cloudflare build pipeline; invoke Next.js directly.
export default {
  ...cloudflareConfig,
  buildCommand: "node node_modules/next/dist/bin/next build",
};
