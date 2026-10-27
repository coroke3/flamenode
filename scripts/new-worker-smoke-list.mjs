/**
 * MIG-0628 U04: source-backed, offline smoke plan for a future owner-run cutover.
 * Never makes network calls or queries Cloudflare. The API mount table is an
 * independent coverage guard against routes omitted from hand-written docs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

export function listHonoMounts(entry) {
  const found = [...entry.matchAll(/app\.route\(\s*["'](\/api\/[^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)(?:\(\))?\s*\)/g)]
    .map(([, path, owner]) => ({ path, owner }));
  const unique = [...new Map(found.map((row) => [row.path + ":" + row.owner, row])).values()];
  return unique.sort((a, b) => a.path.localeCompare(b.path) || a.owner.localeCompare(b.owner));
}

const METHOD = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
function normalizeRoutePath(rawPath) {
  // The API matrix documents query parameters as shorthand (?tab&page).
  // Strip them from the Hono pathname but keep a fixture requirement so an
  // incomplete or privileged GET is never considered a default smoke probe.
  const trimmed = rawPath.replace(/[,;.)\]]+$/, "");
  const hasQuery = trimmed.includes("?");
  const path = trimmed.split("?")[0];
  if (!path.startsWith("/api/") || /[\[\]{}*]/.test(path)) return null;
  // Bracket notation and grouped Next.js documentation paths are not Hono
  // route patterns. Exact real routes must be source-anchored separately.
  if (!/^\/api\/(?:[\w.~-]+|:[A-Za-z_][\w]*)(?:\/(?:[\w.~-]+|:[A-Za-z_][\w]*))*$/.test(path)) return null;
  return { path, requiresFixture: hasQuery };
}

export function collectApiMatrixRoutes(matrix) {
  const out = [];
  for (const match of matrix.matchAll(/\b(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s\x60|"<>]+)/g)) {
    const method = match[1];
    const parsed = normalizeRoutePath(match[2]);
    if (parsed && METHOD.has(method)) {
      out.push({ method, path: parsed.path, requiresFixture: parsed.requiresFixture });
    }
  }
  // If a route appears both with and without documented query parameters,
  // conservatively retain the query fixture requirement.
  const unique = new Map();
  for (const row of out) {
    const key = row.method + " " + row.path;
    const previous = unique.get(key);
    unique.set(key, { ...row, requiresFixture: row.requiresFixture || Boolean(previous?.requiresFixture) });
  }
  return [...unique.values()]
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export function buildNewWorkerSmokePlan({ routeMatrix, apiMatrix, appEntry, sourceRoutes = [] }) {
  const mounts = listHonoMounts(appEntry);
  if (mounts.length === 0) throw new Error("apps/api/src/app.ts has no parsable Hono mounts");
  const documentedByKey = new Map();
  for (const route of [
    ...collectApiMatrixRoutes(apiMatrix),
    ...sourceRoutes.map(({ method, path }) => ({ method, path })),
  ]) {
    const key = route.method + " " + route.path;
    const previous = documentedByKey.get(key);
    documentedByKey.set(key, {
      ...route,
      requiresFixture: Boolean(route.requiresFixture || previous?.requiresFixture),
    });
  }
  const documented = [...documentedByKey.values()];
  const api = documented.filter((r) =>
    mounts.some((m) => r.path === m.path || r.path.startsWith(m.path + "/")));
  // The generated JSON is a review checklist, never a live test runner.
  // Mutating methods must not look safe to automate merely because their URL
  // has no parameters (e.g. POST /api/admin/audit/settings).
  const privilegedPrefixes = ["/api/personal", "/api/admin", "/api/admin-read",
    "/api/manage", "/api/account", "/api/health/deep"];
  const isReadOnlyCandidate = ({ method, path, requiresFixture }) =>
    (method === "GET" || method === "HEAD") &&
    !requiresFixture && !/[:\[\]{}]/.test(path) &&
    !privilegedPrefixes.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
  const manual = api.filter((route) => !isReadOnlyCandidate(route))
    .map((r) => ({
      ...r, mode: "fixture-required",
      // RH-017 deep health intentionally fails closed until the CURRENT
      // authenticated probes are migrated. A 200 expectation is unsafe.
      expected: r.path === "/api/health/deep"
        ? "401 with invalid bearer; 503 until deep-health parity is implemented"
        : "owner-verified contract",
    }));
  const automated = api.filter(isReadOnlyCandidate)
    .map((r) => ({ ...r, mode: "candidate", expected: r.path === "/api/health" ? 200 : "owner-verified contract" }));
  const routeRows = [];
  for (const row of routeMatrix.split("\n")) {
    if (!row.startsWith("|")) continue;
    const match = /^\|\s*\x60(\/[^\x60]*)\x60\s*\|/.exec(row);
    // Only Astro owns public Static Assets. React/Vite app represents
    // authenticated SPA shells and must never enter unauthenticated smoke.
    if (!match || !/\bAstro\/site\b/.test(row)) continue;
    const path = match[1];
    if (!path.includes("*") && !/[:\[\]{}]/.test(path)) routeRows.push(path);
  }
  const publicSmoke = [...new Set(["/", "/robots.txt", "/sitemap.xml",
    ...routeRows.filter((p) => p !== "/" && !p.includes("?") && !p.endsWith("/"))])]
    .filter((p) => p === "/" || !p.includes(" ") )
    .map((path) => ({ method: "GET", path, mode: "candidate", expected: "200 or explicit redirect" }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const coverage = mounts.map(({ path, owner }) => {
    const matches = api.filter((route) => route.path === path || route.path.startsWith(path + "/")).length;
    return { mount: path, owner, documentedMethods: matches, needsManualAudit: matches === 0 };
  });
  return {
    schemaVersion: 1,
    source: { api: "apps/api/src/app.ts", apiMatrix: "docs/migration/API_MATRIX.md",
      routeMatrix: "docs/migration/ROUTE_MATRIX.md" },
    coverage,
    publicSmoke,
    apiSmoke: [...automated, ...manual].sort((a, b) => a.path.localeCompare(b.path)),
    note: "Candidate checklist only. No HTTP calls, no network, no automatic traffic cutover.",
  };
}


// The API_MATRIX is an integration inventory, not necessarily an exhaustive
// live-route index. Explicit source-anchored gaps must be audited and sampled
// before a cutover; do not invent endpoints for uncovered Hono mounts.
const SOURCE_ROUTE_GAPS = Object.freeze([
  { method: "GET", path: "/api/manage", source: "apps/api/src/routes/manage/dashboard.ts", local: "/" },
  { method: "GET", path: "/api/manage/navigation", source: "apps/api/src/routes/manage/navigation.ts", local: "/" },
  { method: "GET", path: "/api/admin/spreadsheet/data", source: "apps/api/src/routes/admin/spreadsheet/read.ts", local: "/data" },
  { method: "GET", path: "/api/admin/spreadsheet/export", source: "apps/api/src/routes/admin/spreadsheet/read.ts", local: "/export" },
  { method: "GET", path: "/api/admin/spreadsheet/tables", source: "apps/api/src/routes/admin/spreadsheet/read.ts", local: "/tables" },
  { method: "GET", path: "/api/google-drive-image/:id", source: "apps/api/src/routes/media/proxies.ts", local: "/:id" },
  { method: "GET", path: "/api/youtube-thumbnail/:id/:size", source: "apps/api/src/routes/media/proxies.ts", local: "/:id/:size" },
  // API_MATRIX uses Next.js [id]/{a,b,c} documentation shorthand here.
  // Probe only the three real mounted Hono endpoints, with id fixtures.
  { method: "GET", path: "/api/live/events/:id/slots", source: "apps/api/src/routes/live/events.ts", local: "/:id/slots" },
  { method: "GET", path: "/api/live/events/:id/submissions", source: "apps/api/src/routes/live/events.ts", local: "/:id/submissions" },
  { method: "GET", path: "/api/live/events/:id/summary", source: "apps/api/src/routes/live/events.ts", local: "/:id/summary" },
]);

// A route named only in a commented-out migration snippet is not a live
// Hono registration. Strip JS/TS comments while preserving quoted path strings
// before checking source-backed smoke coverage.
export function sourceDeclaresGetRoute(source, local) {
  if (typeof source !== "string" || typeof local !== "string" ||
      !local.startsWith("/")) return false;
  let withoutComments = "";
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) {
      if (ch === "\n") { lineComment = false; withoutComments += ch; }
    } else if (blockComment) {
      if (ch === "*" && next === "/") { blockComment = false; i++; }
      else if (ch === "\n") withoutComments += ch;
    } else if (quote !== null) {
      withoutComments += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      withoutComments += ch;
    } else if (ch === "/" && next === "/") {
      lineComment = true; i++;
    } else if (ch === "/" && next === "*") {
      blockComment = true; i++;
    } else withoutComments += ch;
  }
  const escapedLocal = [...local].map((ch) =>
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/_:-".includes(ch)
      ? ch : "\\" + ch).join("");
  return new RegExp("\\.get\\(\\s*[\"']" + escapedLocal + "[\"']\\s*,").test(withoutComments);
}

function verifiedSourceRoutes() {
  return SOURCE_ROUTE_GAPS.map((row) => {
    const content = read(row.source);
    if (!sourceDeclaresGetRoute(content, row.local)) {
      throw new Error("Source route changed: " + row.source + " GET " + row.local);
    }
    return row;
  });
}

export function loadNewWorkerSmokePlan() {
  return buildNewWorkerSmokePlan({
    routeMatrix: read("docs/migration/ROUTE_MATRIX.md"),
    apiMatrix: read("docs/migration/API_MATRIX.md"),
    appEntry: read("apps/api/src/app.ts"),
    sourceRoutes: verifiedSourceRoutes(),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const plan = loadNewWorkerSmokePlan();
  process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  // Never treat this as authorization for production; only list route coverage.
}
