#!/usr/bin/env node
// Run after: npm run build --workspace=@flamenode/site
// Synthetic build output is not evidence of production visibility/cutover.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "apps/site/dist/migration-fixture-poc");

function entryStat(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// Walk without following links so nested symlinks (including dangling ones) are reported.
function findNestedSymlinks(base, relative = "") {
  const found = [];
  let children;
  try {
    children = fs.readdirSync(path.join(base, relative), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const child of children) {
    const rel = relative ? relative + "/" + child.name : child.name;
    if (child.isSymbolicLink()) found.push(rel);
    else if (child.isDirectory()) found.push(...findNestedSymlinks(base, rel));
  }
  return found;
}

export function inspectPublicFixtureBuild(outputDir) {
  const issues = [];
  const fail = (message) => issues.push(message);
  const dirStat = entryStat(outputDir);
  if (!dirStat?.isDirectory()) {
    fail("expected fixture output directory absent or not a real directory");
    return issues;
  }

  // Do not follow symbolic links: a linked fixture can point outside the
  // built output and make the synthetic-only assertion inspect other files.
  const entries = fs.readdirSync(outputDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) fail("symlink in fixture output: " + entry.name);
    else if (entry.isDirectory()) {
      for (const nested of findNestedSymlinks(outputDir, entry.name)) fail("symlink in fixture output: " + nested);
    }
  }

  const htmlPath = path.join(outputDir, "public_demo/index.html");
  const publicDir = entryStat(path.dirname(htmlPath));
  const htmlStat = entryStat(htmlPath);
  if (!publicDir?.isDirectory() || !htmlStat?.isFile()) {
    fail("expected Astro public fixture HTML absent or not a real file");
  } else {
    const html = fs.readFileSync(htmlPath, "utf8");
    if (!html.includes("Synthetic public video")) fail("expected public fixture title missing");
    if (!html.includes('data-synthetic-only="true"')) fail("output does not identify as synthetic fixture");
    if (/Synthetic private video|private_demo/i.test(html)) fail("private fixture leaked to public HTML");
  }

  if (entryStat(path.join(outputDir, "private_demo"))) fail("private fixture produced an HTML route");
  const pages = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const allowed = ["islands", "public_demo"];
  if (pages.length !== allowed.length || pages.slice().sort().some((name, i) => name !== allowed[i])) {
    fail("unexpected public fixtures: " + pages.join(","));
  }

  const islandsHtml = path.join(outputDir, "islands/index.html");
  const islandsDir = entryStat(path.dirname(islandsHtml));
  const islandsStat = entryStat(islandsHtml);
  if (!islandsDir?.isDirectory() || (islandsStat && !islandsStat.isFile())) {
    fail("islands fixture HTML is not a real file");
  } else if (islandsStat && /Synthetic private video|private_demo/i.test(fs.readFileSync(islandsHtml, "utf8"))) {
    fail("private fixture leaked to the islands PoC page");
  }
  return issues;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = inspectPublicFixtureBuild(dir);
  for (const issue of issues) console.error("[MIG-0401 build] FAIL: " + issue);
  if (issues.length) process.exitCode = 1;
  else console.log("[MIG-0401 build] PASS: exactly one synthetic public fixture HTML output (plus the Island PoC page); private fixture denied; no production routing");
}
