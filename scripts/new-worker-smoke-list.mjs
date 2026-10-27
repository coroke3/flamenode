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
function normalizeRoutePath(path) {
  if (!path.startsWith("/api/")) return null;
  const result = path.replace(/[,;.)\]]+$/, "");
  if (result.includes("*") || result.includes("?")) return null;
  return result;
}

export function collectApiMatrixRoutes(matrix) {
  const out = [];
  for (const match of matrix.matchAll(/\b(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s\x60|"<>]+)/g)) {
    const method = match[1];
    const path = normalizeRoutePath(match[2]);
    if (path && METHOD.has(method)) out.push({ method, path });
  }
  return [...new Map(out.map((route) => [route.method + " " + route.path, route])).values()]
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export function buildNewWorkerSmokePlan({ routeMatrix, apiMatrix, appEntry, sourceRoutes = [] }) {
  const mounts = listHonoMounts(appEntry);
  if (mounts.length === 0) throw new Error("apps/api/src/app.ts has no parsable Hono mounts");
  const documented = [...new Map([
    ...collectApiMatrixRoutes(apiMatrix),
    ...sourceRoutes.map(({ method, path }) => ({ method, path })),
  ].map((route) => [route.method + " " + route.path, route])).values()];
  const api = documented.filter((r) =>
    mounts.some((m) => r.path === m.path || r.path.startsWith(m.path + "/")));
  const manual = api.filter(({ path }) => /[:\[\]{}]/.test(path))
    .map((r) => ({ ...r, mode: "fixture-required", expected: "owner-verified contract" }));
  const automated = api.filter(({ path }) => !/[:\[\]{}]/.test(path))
    .map((r) => ({ ...r, mode: "candidate", expected: r.path === "/api/health" ? 200 : "owner-verified contract" }));
  const routeRows = [];
  for (const row of routeMatrix.split("\n")) {
    if (!row.startsWith("|")) continue;
    const match = /^\|\s*\x60(\/[^\x60]*)\x60\s*\|/.exec(row);
    if (!match || !/\b(Astro\/site|React\/Vite app)\b/.test(row)) continue;
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
]);

function verifiedSourceRoutes() {
  return SOURCE_ROUTE_GAPS.map((row) => {
    const content = read(row.source);
    if (!content.includes('.get("' + row.local + '"')) {
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
