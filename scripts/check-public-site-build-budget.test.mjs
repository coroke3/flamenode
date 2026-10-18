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
  WARN_THRESHOLD_FILES,
} from "./check-public-site-build-budget.mjs";

function createMockDist(fileCount) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "flamenode-dist-budget-"));
  fs.mkdirSync(path.join(tmpDir, "nested"));
  for (let i = 0; i < fileCount; i++) {
    const ext = i % 3 === 0 ? ".html" : i % 3 === 1 ? ".js" : ".css";
    // Half of the files sit in a subdirectory, as Astro page directories do.
    fs.writeFileSync(path.join(tmpDir, i % 2 ? "nested" : "", `asset-${i}${ext}`), "x");
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

test("T01: real 19,999 / 20,000 / 20,001 file trees against the default Free limit", () => {
  const dir = createMockDist(MAX_ALLOWED_FILES + 1);
  try {
    const exceeded = analyzeDistFiles(dir);
    assert.equal(exceeded.totalFiles, 20_001);
    assert.equal(exceeded.status, "EXCEEDED");
    assert.equal(exceeded.margin, -1);
    assert.equal(exceeded.breakdown.html + exceeded.breakdown.js + exceeded.breakdown.css, 20_001);
    assert.throws(() => runPreflightCheck(dir), /\(20001\) exceed Cloudflare limit of 20000 files\/version by 1/);

    fs.rmSync(path.join(dir, "asset-20000.css"));
    const exact = analyzeDistFiles(dir);
    assert.equal(exact.totalFiles, 20_000);
    assert.equal(exact.margin, 0);
    // At the limit the upload still succeeds, but it is past the warning threshold.
    assert.equal(exact.status, "WARNING");
    assert.equal(runPreflightCheck(dir).status, "WARNING");

    fs.rmSync(path.join(dir, "nested", "asset-19999.js"));
    const below = analyzeDistFiles(dir);
    assert.equal(below.totalFiles, 19_999);
    assert.equal(below.status, "WARNING");
    assert.equal(below.margin, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("warning starts at 18,000 files", () => {
  const dir = createMockDist(10);
  try {
    assert.equal(analyzeDistFiles(dir, { maxAllowed: 20, warnThreshold: 11 }).status, "OK");
    assert.equal(analyzeDistFiles(dir, { maxAllowed: 20, warnThreshold: 10 }).status, "WARNING");
    assert.equal(WARN_THRESHOLD_FILES, 18_000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Real apps/site/dist output is within safe capacity budget", (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const distDir = path.join(root, "apps/site/dist");
  if (!fs.existsSync(distDir)) {
    t.skip("apps/site/dist not built; CI runs `node scripts/check-public-site-build-budget.mjs` after the site build");
    return;
  }
  {
    const result = analyzeDistFiles(distDir);
    assert.equal(result.status, "OK");
    assert.ok(result.totalFiles < MAX_ALLOWED_FILES);
    assert.ok(result.margin > 19_000, `Expected ample margin in PoC dist, got: ${result.margin}`);
    console.log(`[Real Dist] Total: ${result.totalFiles}, Margin: ${result.margin}`);
  }
});
