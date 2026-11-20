/**
 * MIG-0507 U12: capture a member-present video detail page from a local Astro preview.
 * Screenshot collection is evidence for a later human mock comparison, NOT visual approval.
 * Requires Playwright CLI with Chromium installed; never contacts production.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MOCK_REFERENCE = "docs/migration/mock/screenshots/VideoDetail";
const HELP = "Usage: node scripts/fixtures/videoScreenshotCapture.mjs <http-loopback-origin> <member-video-slug> <existing-empty-absolute-output-dir>\n";

function localOrigin(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("origin must be an HTTP loopback URL"); }
  if (url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("origin must be an HTTP loopback origin without credentials, path, query or fragment");
  }
  return url.origin;
}

function emptyOutputDirectory(dir) {
  if (typeof dir !== "string" || !path.isAbsolute(dir) ||
      path.resolve(dir) === path.parse(dir).root || !fs.existsSync(dir) ||
      !fs.lstatSync(dir).isDirectory() || fs.readdirSync(dir).length !== 0) {
    throw new Error("output must be an existing, empty, non-root absolute directory");
  }
  return dir;
}

async function memberPresentHtml(url) {
  // Never follow a redirect out of the local preview host.
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
  if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) {
    await response.body?.cancel();
    throw new Error("expected locally served video HTML 200 without redirect");
  }
  const html = await response.text();
  const rows = [...html.matchAll(/class=["'][^"']*\bvd-mrow\b[^"']*["']/g)].length;
  if (rows < 1) throw new Error("no rendered member rows: U12 requires a member-present Astro fixture");
  return rows;
}

function screenshot(cli, url, destination, viewport) {
  execFileSync(cli, [
    "screenshot", "--browser", "chromium", "--full-page", "--color-scheme", "dark",
    "--wait-for-timeout", "800", "--viewport-size", viewport.width + "," + viewport.height,
    url, destination,
  ], { timeout: 90000, stdio: "pipe" });
  const image = fs.readFileSync(destination);
  if (image.length < 24 || !image.subarray(0, 8).equals(PNG_SIGNATURE) ||
      image.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Playwright did not produce a valid PNG header");
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width !== viewport.width || height < viewport.height) {
    throw new Error("PNG dimensions mismatch: expected " + viewport.width + "x>=" +
      viewport.height + ", got " + width + "x" + height);
  }
  return {
    imageSize: width + "x" + height,
    sha256: createHash("sha256").update(image).digest("hex"),
    bytes: image.length,
  };
}

export async function captureVideoEvidence(origin, slug, dir, cli = "playwright") {
  const base = localOrigin(origin);
  if (typeof slug !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(slug)) {
    throw new Error("video slug must be one safe route segment of 1–64 characters");
  }
  const output = emptyOutputDirectory(dir);
  const url = base + "/" + slug + "/";
  const memberRows = await memberPresentHtml(url);
  const files = [];
  try {
    for (const viewport of VIEWPORTS) {
      const file = "video." + viewport.name + ".png";
      const result = screenshot(cli, url, path.join(output, file), viewport);
      files.push({
        file, viewport: viewport.width + "x" + viewport.height, ...result,
        mockReference: MOCK_REFERENCE + "." + viewport.name + ".jpg",
      });
    }
    const evidence = {
      task: "MIG-0507", unit: "U12", source: "local Astro SSR + Playwright Chromium",
      videoSlug: slug, memberRows, screenshotCount: files.length,
      visualComparison: "NOT_REVIEWED", permissionParity: "NOT_REVIEWED",
      productionSample: false, files,
    };
    fs.writeFileSync(path.join(output, "evidence.json"),
      JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
    return evidence;
  } catch (error) {
    for (const viewport of VIEWPORTS) {
      try { fs.unlinkSync(path.join(output, "video." + viewport.name + ".png")); }
      catch { /* best effort */ }
    }
    try { fs.unlinkSync(path.join(output, "evidence.json")); }
    catch { /* best effort */ }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2])) {
    process.stdout.write(HELP);
  } else if (process.argv.length === 5) {
    await captureVideoEvidence(process.argv[2], process.argv[3], process.argv[4],
      process.env.PLAYWRIGHT_CLI || "playwright");
  } else {
    process.stderr.write(HELP);
    process.exitCode = 2;
  }
}
