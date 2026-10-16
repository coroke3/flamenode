import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  categorizeFile,
  analyzeDistFiles,
  runPreflightCheck,
  MAX_ALLOWED_FILES,
} from "./check-public-site-build-budget.mjs";
import { loadR2PrebuiltHtml } from "../apps/site/src/gateway/r2Html.ts";

function createMockDist(fileCount, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-dist-budget-"));
  // Write files
  for (let i = 0; i < fileCount; i++) {
    const ext = options.ext || (i % 3 === 0 ? ".html" : i % 3 === 1 ? ".js" : ".css");
    fs.writeFileSync(path.join(tmpDir, `asset-${i}${ext}`), "content");
  }
  return tmpDir;
}

test("categorizeFile categorizes known asset types and redirects", () => {
  assert.equal(categorizeFile("index.html"), "html");
  assert.equal(categorizeFile("app.js"), "js");
  assert.equal(categorizeFile("module.mjs"), "js");
  assert.equal(categorizeFile("style.css"), "css");
  assert.equal(categorizeFile("font.woff2"), "font");
  assert.equal(categorizeFile("banner.webp"), "image");
  assert.equal(categorizeFile("icon.ico"), "image");
  assert.equal(categorizeFile("path/to/_redirects"), "redirect");
  assert.equal(categorizeFile("data.unknown"), "other");
});

test("T01: analyzeDistFiles correctly computes margin and status for boundary conditions", () => {
  // 1. Boundary: 19,999 files (mocked via options.maxAllowed)
  const mockDir = createMockDist(10);
  try {
    const resultNormal = analyzeDistFiles(mockDir, { maxAllowed: 15, warnThreshold: 12 });
    assert.equal(resultNormal.status, "OK");
    assert.equal(resultNormal.totalFiles, 10);
    assert.equal(resultNormal.margin, 5);

    // 2. Exact boundary: 20,000 files (without warning threshold)
    const resultExact = analyzeDistFiles(mockDir, { maxAllowed: 10, warnThreshold: 11 });
    assert.equal(resultExact.status, "OK");
    assert.equal(resultExact.totalFiles, 10);
    assert.equal(resultExact.margin, 0);

    // 3. Exceeded boundary: 20,001 files
    const resultExceeded = analyzeDistFiles(mockDir, { maxAllowed: 9, warnThreshold: 8 });
    assert.equal(resultExceeded.status, "EXCEEDED");
    assert.equal(resultExceeded.totalFiles, 10);
    assert.equal(resultExceeded.margin, -1);

    // 4. Warning threshold: >= 18,000
    const resultWarn = analyzeDistFiles(mockDir, { maxAllowed: 15, warnThreshold: 10 });
    assert.equal(resultWarn.status, "WARNING");
  } finally {
    fs.rmSync(mockDir, { recursive: true, force: true });
  }
});

test("T01: runPreflightCheck throws when static asset quota is exceeded", () => {
  const mockDir = createMockDist(10);
  try {
    // Should pass when below limit
    const passed = runPreflightCheck(mockDir, { maxAllowed: 20 });
    assert.equal(passed.status, "OK");

    // Should throw when exceeding limit
    assert.throws(
      () => runPreflightCheck(mockDir, { maxAllowed: 9 }),
      /Total static assets \(10\) exceed Cloudflare limit of 9 files\/version by 1!/,
    );
  } finally {
    fs.rmSync(mockDir, { recursive: true, force: true });
  }
});

test("Real apps/site/dist output is within safe capacity budget", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const distDir = path.join(root, "apps/site/dist");

  if (fs.existsSync(distDir)) {
    const result = analyzeDistFiles(distDir);
    assert.equal(result.status, "OK");
    assert.ok(result.totalFiles < MAX_ALLOWED_FILES);
    assert.ok(result.margin > 19_000, `Expected ample margin in PoC dist, got: ${result.margin}`);
    console.log(`[Real Dist] Total: ${result.totalFiles}, Margin: ${result.margin}`);
  }
});

test("T02: loadR2PrebuiltHtml rejects stale generation with 503", async () => {
  const mockR2 = {
    get: async () => ({
      body: "<html>Old Content</html>",
      customMetadata: { generation: "gen-2026-10-15-old" },
    }),
  };

  const result = await loadR2PrebuiltHtml("video-123/index.html", {
    r2: mockR2,
    expectedGeneration: "gen-2026-10-17-new",
  });

  assert.equal(result.action, "unavailable");
  if (result.action === "unavailable") {
    assert.equal(result.status, 503);
    assert.equal(result.reason, "stale_generation");
  }
});

test("T03: loadR2PrebuiltHtml fails closed with 503 on storage errors", async () => {
  const failingR2 = {
    get: async () => {
      throw new Error("R2 connection timeout");
    },
  };

  const result = await loadR2PrebuiltHtml("video-123/index.html", {
    r2: failingR2,
  });

  assert.equal(result.action, "unavailable");
  if (result.action === "unavailable") {
    assert.equal(result.status, 503);
    assert.equal(result.reason, "r2_read_failed");
  }
});

test("T04: loadR2PrebuiltHtml denies post-build revoked items with 404 noindex", async () => {
  const mockR2 = {
    get: async () => ({
      body: "<html>Private Content</html>",
      customMetadata: { generation: "gen-2026-10-17" },
    }),
  };

  const isRevoked = (key) => key.includes("video-private-456");

  const result = await loadR2PrebuiltHtml("video-private-456/index.html", {
    r2: mockR2,
    expectedGeneration: "gen-2026-10-17",
    isRevoked,
  });

  assert.equal(result.action, "deny");
  if (result.action === "deny") {
    assert.equal(result.status, 404);
    assert.equal(result.reason, "revoked");
    assert.ok(result.headers["X-Robots-Tag"].includes("noindex"));
  }
});

test("loadR2PrebuiltHtml serves valid pre-generated HTML with 200", async () => {
  const mockR2 = {
    get: async (k) => ({
      body: `<html>Rendered HTML for ${k}</html>`,
      customMetadata: { generation: "gen-2026-10-17" },
      httpMetadata: { contentType: "text/html; charset=utf-8" },
    }),
  };

  const result = await loadR2PrebuiltHtml("video-public-789/index.html", {
    r2: mockR2,
    expectedGeneration: "gen-2026-10-17",
  });

  assert.equal(result.action, "serve");
  if (result.action === "serve") {
    assert.equal(result.status, 200);
    assert.equal(result.contentType, "text/html; charset=utf-8");
    assert.ok(result.headers["Cache-Control"].includes("public"));
  }
});
