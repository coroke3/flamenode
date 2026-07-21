import { createRequire } from "node:module";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// next.config 評価時点で .dev.vars を読む（RSC ワーカーとフラグ判定のずれ防止）
createRequire(import.meta.url)("./scripts/load-dev-vars.cjs");

if (process.env.NODE_ENV === "development" && process.env.LOCAL_BINDINGS !== "0") {
  await initOpenNextCloudflareForDev({
    configPath: "wrangler.toml",
    persist: { path: ".wrangler/state/v3" },
    remoteBindings: false,
    envFiles: [],
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "cdn.discordapp.com" },
      { protocol: "https", hostname: "pbs.twimg.com" },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
