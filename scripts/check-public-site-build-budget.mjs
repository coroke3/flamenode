#!/usr/bin/env node
/**
 * Public site build budget preflight checker (MIG-0406 / Recipe R-BUILD / Runtime N).
 * Enforces Cloudflare Workers Static Assets quota (max 20,000 files per version).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const MAX_ALLOWED_FILES = 20_000;
export const WARN_THRESHOLD_FILES = 18_000;

export const CATEGORY_EXTENSIONS = Object.freeze({
  html: new Set([".html", ".htm"]),
  js: new Set([".js", ".mjs", ".cjs"]),
  css: new Set([".css"]),
  font: new Set([".woff", ".woff2", ".ttf", ".eot", ".otf"]),
  image: new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico"]),
  redirect: new Set(["_redirects"]),
});

export function categorizeFile(filePath) {
  const baseName = path.basename(filePath);
  if (baseName === "_redirects") return "redirect";
  const ext = path.extname(filePath).toLowerCase();
  for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
    if (extensions.has(ext)) return category;
  }
  return "other";
}

export function analyzeDistFiles(distDir, options = {}) {
  const maxAllowed = options.maxAllowed ?? MAX_ALLOWED_FILES;
  const warnThreshold = options.warnThreshold ?? WARN_THRESHOLD_FILES;

  if (!fs.existsSync(distDir)) {
    throw new Error(`Build output directory not found: ${distDir}`);
  }

  const breakdown = {
    html: 0,
    js: 0,
    css: 0,
    font: 0,
    image: 0,
    redirect: 0,
    other: 0,
  };

  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const category = categorizeFile(fullPath);
        breakdown[category] = (breakdown[category] || 0) + 1;
        files.push(path.relative(distDir, fullPath).replaceAll(path.sep, "/"));
      }
    }
  }

  walk(distDir);

  const totalFiles = files.length;
  const margin = maxAllowed - totalFiles;
  const status = totalFiles > maxAllowed ? "EXCEEDED" : totalFiles >= warnThreshold ? "WARNING" : "OK";

  return {
    distDir,
    totalFiles,
    maxAllowed,
    warnThreshold,
    margin,
    status,
    breakdown,
    files,
  };
}

export function runPreflightCheck(distDir, options = {}) {
  const result = analyzeDistFiles(distDir, options);

  console.log(`[build-budget] Inspected directory: ${result.distDir}`);
  console.log(`[build-budget] Total files: ${result.totalFiles} / ${result.maxAllowed} (Margin: ${result.margin})`);
  console.log(`[build-budget] Breakdown: HTML=${result.breakdown.html}, JS=${result.breakdown.js}, CSS=${result.breakdown.css}, Font=${result.breakdown.font}, Image=${result.breakdown.image}, Redirects=${result.breakdown.redirect}, Other=${result.breakdown.other}`);

  if (result.status === "EXCEEDED") {
    const msg = `[build-budget] FAILED: Total static assets (${result.totalFiles}) exceed Cloudflare limit of ${result.maxAllowed} files/version by ${result.totalFiles - result.maxAllowed}!`;
    console.error(msg);
    throw new Error(msg);
  }

  if (result.status === "WARNING") {
    console.warn(`[build-budget] WARNING: Total static assets (${result.totalFiles}) exceed warning threshold of ${result.warnThreshold} files (approaching limit of ${result.maxAllowed}).`);
  } else {
    console.log(`[build-budget] PASS: Static asset quota within safe capacity.`);
  }

  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const defaultDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/site/dist");
  const targetDir = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultDist;
  try {
    runPreflightCheck(targetDir);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
