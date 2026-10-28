/**
 * MIG-0505 U02: collect six actual-browser screenshots, without treating them
 * as visual acceptance. Run after a fixture-based Astro build is served locally.
 *
 * Requires the Playwright CLI and installed Chromium browser on PATH.
 * Does not install dependencies, contact production or modify repository files.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROUTES = ["list", "recommend", "trending"];
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const HELP = `Usage: node scripts/fixtures/listingScreenshotCapture.mjs <local-origin> <empty-absolute-output-dir>\n\nExample: node scripts/fixtures/listingScreenshotCapture.mjs http://127.0.0.1:4329 /tmp/listing-shots\nRequires: playwright CLI with Chromium installed; serves/builds nothing itself.\nOutput: 6 PNG screenshots and evidence.json (capture metadata only; NOT visual approval).\n`;

function localOrigin(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("origin must be an absolute local HTTP URL"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("origin must be an HTTP loopback origin without credentials, path, query or fragment");
  }
  return url.origin;
}

function emptyDirectory(dir) {
  if (typeof dir !== "string" || !path.isAbsolute(dir) || path.resolve(dir) === path.parse(dir).root) {
    throw new Error("output must be a non-root absolute directory");
  }
  if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory() || fs.readdirSync(dir).length !== 0) {
    throw new Error("output must exist, be a real directory and be empty");
  }
  return dir;
}

function screenshot(cli, url, destination, viewport) {
  execFileSync(cli, [
    "screenshot", "--browser", "chromium", "--full-page", "--color-scheme", "dark",
    "--wait-for-timeout", "800", "--viewport-size", `${viewport.width},${viewport.height}`,
    url, destination,
  ], { stdio: "inherit", timeout: 90_000 });
  const bytes = fs.readFileSync(destination);
  if (bytes.length <= PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`Playwright did not produce a valid PNG: ${destination}`);
  }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

async function assertLocalHtml(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    throw new Error(`Visual route must serve HTML 200 before capture: ${url} (${response.status})`);
  }
  await response.body?.cancel();
}

export async function captureListingEvidence(origin, dir, cli = "playwright") {
  const baseUrl = localOrigin(origin);
  const output = emptyDirectory(dir);
  const files = [];
  try {
    for (const route of ROUTES) {
      await assertLocalHtml(`${baseUrl}/${route}/`);
      for (const viewport of VIEWPORTS) {
        const name = `${route}.${viewport.name}.png`;
        const url = `${baseUrl}/${route}/`;
        const { sha256, bytes } = screenshot(cli, url, path.join(output, name), viewport);
        files.push({ file: name, url, viewport: `${viewport.width}x${viewport.height}`, sha256, bytes });
      }
    }
    const evidence = {
      task: "MIG-0505", source: "Playwright Chromium", colorScheme: "dark",
      fullPage: true, waitForTimeoutMs: 800, screenshotCount: files.length,
      visualComparison: "NOT_REVIEWED", files,
    };
    // Write the manifest only after all six captures succeeded. This file does
    // not imply (c)=0, parity, mock acceptance or a successful production route.
    fs.writeFileSync(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
    return evidence;
  } catch (error) {
    // A partial collection must not be mistaken for complete evidence.
    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        try { fs.unlinkSync(path.join(output, `${route}.${viewport.name}.png`)); } catch { /* best effort */ }
      }
    }
    try { fs.unlinkSync(path.join(output, "evidence.json")); } catch { /* best effort */ }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2])) {
    process.stdout.write(HELP);
  } else if (process.argv.length === 4) {
    await captureListingEvidence(process.argv[2], process.argv[3], process.env.PLAYWRIGHT_CLI || "playwright");
  } else {
    process.stderr.write(HELP);
    process.exitCode = 2;
  }
}
