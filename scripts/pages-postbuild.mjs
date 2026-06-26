#!/usr/bin/env node
/**
 * next-on-pages ビルド後に _routes.json を補正し、静的アセットへの Functions 呼び出しを減らす。
 * 無料枠の Workers/Pages Functions リクエスト節約に寄与する。
 */
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(".vercel", "output", "static");
const ROUTES_PATH = path.join(OUT_DIR, "_routes.json");

const EXTRA_EXCLUDES = [
  "/_next/static/*",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/site.webmanifest",
  "/*.png",
  "/*.ico",
  "/*.svg",
  "/*.webp",
];

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    console.warn("[pages-postbuild] build output not found, skipped.");
    return;
  }

  let routes = { version: 1, include: ["/*"], exclude: [] };
  if (fs.existsSync(ROUTES_PATH)) {
    routes = JSON.parse(fs.readFileSync(ROUTES_PATH, "utf8"));
  }

  routes.version = routes.version ?? 1;
  routes.include = routes.include ?? ["/*"];
  routes.exclude = [...new Set([...(routes.exclude ?? []), ...EXTRA_EXCLUDES])];

  fs.writeFileSync(ROUTES_PATH, JSON.stringify(routes, null, 2) + "\n");
  console.log(`[pages-postbuild] patched ${ROUTES_PATH}`);
}

main();
