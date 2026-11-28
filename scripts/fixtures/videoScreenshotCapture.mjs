/**
 * MIG-0507 U12: capture a member-present or no-YouTube video detail page from a local Astro preview.
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

const MAX_PNG_BYTES = 64 * 1024 * 1024;

// Reject truncated/corrupt captures before recording them as screenshot evidence.
// PNG's dimension header alone is not evidence of a complete decodable file.
function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatedPngDimensions(image) {
  if (image.length < 57 || image.length > MAX_PNG_BYTES ||
      !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("invalid PNG: signature, size or missing required chunks");
  }
  let offset = PNG_SIGNATURE.length;
  let width = null;
  let height = null;
  let hasIdat = false;
  let hasIend = false;
  while (offset + 12 <= image.length) {
    const length = image.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > image.length) throw new Error("invalid PNG: truncated chunk");
    const type = image.toString("ascii", offset + 4, offset + 8);
    if (image.readUInt32BE(offset + 8 + length) !==
        crc32(image, offset + 4, offset + 8 + length)) {
      throw new Error("invalid PNG: chunk CRC mismatch");
    }
    if (offset === PNG_SIGNATURE.length) {
      if (type !== "IHDR" || length !== 13) throw new Error("invalid PNG: missing IHDR");
      width = image.readUInt32BE(offset + 8);
      height = image.readUInt32BE(offset + 12);
      if (width === 0 || height === 0) throw new Error("invalid PNG: zero dimensions");
    } else if (type === "IHDR") {
      throw new Error("invalid PNG: duplicate IHDR");
    }
    if (type === "IDAT") {
      if (length === 0) throw new Error("invalid PNG: empty IDAT");
      hasIdat = true;
    }
    if (type === "IEND") {
      if (length !== 0 || end !== image.length) throw new Error("invalid PNG: trailing bytes");
      hasIend = true;
      break;
    }
    offset = end;
  }
  if (!hasIdat || !hasIend) throw new Error("invalid PNG: missing IDAT or IEND");
  return { width, height };
}

const MOCK_REFERENCE = "docs/migration/mock/screenshots/VideoDetail";
const HELP = "Usage: node scripts/fixtures/videoScreenshotCapture.mjs <http-loopback-origin> <video-slug> <existing-empty-absolute-output-dir> [--no-youtube]\n";

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

async function checkVideoHtml(url, variant) {
  // Never follow a redirect out of the local preview host.
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
  if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) {
    await response.body?.cancel();
    throw new Error("expected locally served video HTML 200 without redirect");
  }
  const html = await response.text();
  const rows = [...html.matchAll(/class=["'][^"']*\bvd-mrow\b[^"']*["']/g)].length;
  if (variant === "member-present") {
    if (rows < 1) throw new Error("no rendered member rows: U12 requires a member-present Astro fixture");
  } else {
    // Match the actual no-YouTube fallback, not the temporary loading text or
    // an arbitrary 200 page. This is SSR preflight, not browser approval.
    const emptyPlayer = /<p\b[^>]*\bclass=["'][^"']*\bvd-player-empty\b[^"']*["'][^>]*>\s*YouTube動画は未登録ですが、作品情報を公開しています。\s*<\/p>/u;
    if (!emptyPlayer.test(html)) throw new Error("no rendered no-YouTube fallback: U12 requires a no-YouTube Astro fixture");
  }
  return rows;
}

function screenshot(cli, url, destination, viewport) {
  execFileSync(cli, [
    "screenshot", "--browser", "chromium", "--full-page", "--color-scheme", "dark",
    "--wait-for-timeout", "800", "--viewport-size", viewport.width + "," + viewport.height,
    url, destination,
  ], { timeout: 90000, stdio: "pipe" });
  const image = fs.readFileSync(destination);
  const { width, height } = validatedPngDimensions(image);
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

export async function captureVideoEvidence(origin, slug, dir, cli = "playwright", variant = "member-present") {
  if (variant !== "member-present" && variant !== "no-youtube") {
    throw new Error("unknown video evidence variant");
  }
  const base = localOrigin(origin);
  if (typeof slug !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(slug)) {
    throw new Error("video slug must be one safe route segment of 1–64 characters");
  }
  const output = emptyOutputDirectory(dir);
  const url = base + "/" + slug + "/";
  const memberRows = await checkVideoHtml(url, variant);
  const files = [];
  try {
    for (const viewport of VIEWPORTS) {
      const file = "video." + viewport.name + ".png";
      const result = screenshot(cli, url, path.join(output, file), viewport);
      files.push({
        file, viewport: viewport.width + "x" + viewport.height, ...result,
        mockReference: MOCK_REFERENCE + "." + viewport.name + ".jpg",
        // Only the member-present mock is registered; no-YouTube uses it as
        // a general layout reference, never as a matching state screenshot.
        mockComparisonScope: variant === "no-youtube" ? "LAYOUT_ONLY" : "MEMBER_PRESENT",
      });
    }
    const evidence = {
      task: "MIG-0507", unit: "U12", source: "local Astro SSR + Playwright Chromium",
      videoSlug: slug, variant, memberRows, screenshotCount: files.length,
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
  } else if (process.argv.length === 5 || (process.argv.length === 6 && process.argv[5] === "--no-youtube")) {
    await captureVideoEvidence(process.argv[2], process.argv[3], process.argv[4],
      process.env.PLAYWRIGHT_CLI || "playwright", process.argv[5] === "--no-youtube" ? "no-youtube" : "member-present");
  } else {
    process.stderr.write(HELP);
    process.exitCode = 2;
  }
}
