/**
 * Edge policy of the public gateway (MIG-0619 / Recipe R-GATEWAY / Runtime S1): canonical host
 * redirect and maintenance redirect, with the same decisions as CURRENT `middleware.ts:45-88`
 * (`src/lib/auth/canonicalHostRedirect.ts`, `src/lib/operationMode/middlewareMaintenance.ts`).
 * Self-contained so the Worker bundle does not pull CURRENT `src/lib`; the contract with CURRENT
 * is pinned by `edgePolicy.test.mjs`, which runs the CURRENT functions on the same tables.
 * Non-production PoC: no wrangler.toml, Route or Custom Domain uses it yet.
 */

/** CURRENT `OPERATION_MODE_KV_KEY` (`src/lib/operationMode/kvMirrorCore.ts`). */
export const OPERATION_MODE_KV_KEY = "operation_mode:mirror";
const MAINTENANCE_LOCAL_TTL_MS = 5_000;
const MAINTENANCE_KV_CACHE_TTL_SEC = 30;
/** CURRENT `isOperationMode` (`packages/domain/src/admin/operationMode.ts`). */
const OPERATION_MODES: ReadonlySet<string> = new Set([
  "normal",
  "economy",
  "read_only",
  "static_only",
  "maintenance",
]);

export interface EdgePolicyEnv {
  /** CURRENT `NEXT_PUBLIC_SITE_URL` / `AUTH_URL` (runtime vars, as `middleware.ts:25-31`). */
  NEXT_PUBLIC_SITE_URL?: string;
  AUTH_URL?: string;
  /** CURRENT `MAINTENANCE_MODE=1`. */
  MAINTENANCE_MODE?: string;
  /** Operation-mode mirror: the same `KV` binding CURRENT reads (`getCloudflareContext().env.KV`). */
  KV?: { get: (key: string, options?: { cacheTtl?: number }) => Promise<string | null> };
}

function matchesPathSegmentPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isWorkersDevHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "workers.dev" || normalized.endsWith(".workers.dev");
}

/** CURRENT `isLoopbackHostname` (`src/lib/auth/origin.ts`). */
function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

function parseRequestHost(value: string | null | undefined): URL | null {
  const host = value?.split(",")[0]?.trim().toLowerCase();
  if (!host) return null;
  try {
    const url = new URL(`https://${host}`);
    // Reject hosts that the URL parser normalizes away (e.g. default :443).
    return url.host === host ? url : null;
  } catch {
    return null;
  }
}

/** CURRENT `configuredHttpOrigin(value, _, { allowLoopback: true })`; null where CURRENT throws. */
function configuredOriginOf(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url.origin;
}

/** CURRENT `resolveCanonicalHostRedirect`: the canonical URL, or null to keep the request. */
export function resolveCanonicalHostRedirect(input: {
  configuredOrigin: string | null | undefined;
  forwardedHost: string | null | undefined;
  host: string | null | undefined;
  pathname: string;
  search: string;
}): string | null {
  const canonicalOrigin = configuredOriginOf(input.configuredOrigin);
  if (!canonicalOrigin) return null;
  const canonical = new URL(canonicalOrigin);
  if (isWorkersDevHostname(canonical.hostname)) return null;
  // Keep health probes reachable on workers.dev for smoke/monitoring.
  if (input.pathname === "/api/health" || input.pathname.startsWith("/api/health/")) return null;
  const requestUrl = parseRequestHost(input.forwardedHost || input.host);
  if (!requestUrl || isLoopbackHostname(requestUrl.hostname) || requestUrl.host === canonical.host) {
    return null;
  }
  const target = new URL(canonicalOrigin);
  target.pathname = input.pathname.startsWith("/") ? input.pathname : `/${input.pathname}`;
  target.search = input.search;
  return target.toString();
}

/**
 * Paths CURRENT's `middleware.ts` `config.matcher` never runs the middleware for
 * (`/((?!_next/static|_next/image|favicon.ico).*)`, a plain prefix test). The gateway's build
 * output is `/_astro/` instead of `/_next/static`, so it takes the same place; the maintenance
 * page needs its external CSS, and canonical redirects must not touch build assets.
 */
export function isPolicyBypassPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_astro/") ||
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/_next/image") ||
    pathname.startsWith("/favicon.ico")
  );
}

/** Paths CURRENT keeps reachable while maintenance is on (`middleware.ts:79-86`). */
export function isMaintenanceExempt(pathname: string): boolean {
  return (
    matchesPathSegmentPrefix(pathname, "/maintenance") ||
    matchesPathSegmentPrefix(pathname, "/admin") ||
    matchesPathSegmentPrefix(pathname, "/api/auth") ||
    matchesPathSegmentPrefix(pathname, "/api/health")
  );
}

let maintenanceCache = { value: false, expiresAt: 0 };

/** Test hook: forget the isolate-local maintenance value. */
export function resetEdgePolicyCache(): void {
  maintenanceCache = { value: false, expiresAt: 0 };
}

/** CURRENT `parseOperationModeKvMirror`, reduced to the mode string; null when invalid. */
function parseMirrorMode(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { mode?: unknown; updated_at?: unknown };
    if (typeof parsed.mode !== "string" || !OPERATION_MODES.has(parsed.mode)) return null;
    if (typeof parsed.updated_at !== "number" || !Number.isFinite(parsed.updated_at)) return null;
    return parsed.mode;
  } catch {
    return null;
  }
}

/**
 * CURRENT `resolveMiddlewareMaintenance`: env flag, else the KV mirror cached 5 s per isolate
 * (KV `cacheTtl` 30 s). A missing binding or a KV failure is fail-open (false) and cached briefly.
 */
async function isMaintenance(env: EdgePolicyEnv, now: number): Promise<boolean> {
  if (env.MAINTENANCE_MODE === "1") return true;
  if (now < maintenanceCache.expiresAt) return maintenanceCache.value;
  let value = false;
  try {
    if (env.KV) {
      const raw = await env.KV.get(OPERATION_MODE_KV_KEY, { cacheTtl: MAINTENANCE_KV_CACHE_TTL_SEC });
      value = parseMirrorMode(raw) === "maintenance";
    }
  } catch {
    value = false;
  }
  maintenanceCache = { value, expiresAt: now + MAINTENANCE_LOCAL_TTL_MS };
  return value;
}

/**
 * CURRENT `middleware()` order: `/api/health` passes, then canonical host (308), then maintenance
 * (`/maintenance`, `NextResponse.redirect` default 307). Returns null to let the gateway continue.
 */
export async function applyEdgePolicy(
  request: Request,
  env: EdgePolicyEnv,
  now = Date.now(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (isPolicyBypassPath(url.pathname)) return null;
  if (matchesPathSegmentPrefix(url.pathname, "/api/health")) return null;

  const canonical = resolveCanonicalHostRedirect({
    configuredOrigin: env.NEXT_PUBLIC_SITE_URL?.trim() || env.AUTH_URL?.trim(),
    forwardedHost: request.headers.get("x-forwarded-host"),
    // Workers always carries Host; `url.host` is the same value where a runtime hides the header.
    host: request.headers.get("host") ?? url.host,
    pathname: url.pathname,
    search: url.search,
  });
  if (canonical) return Response.redirect(canonical, 308);

  // CURRENT reads the mirror before the allowlist; the answer is identical and an exempt path
  // does not need the read.
  if (isMaintenanceExempt(url.pathname)) return null;
  if (!(await isMaintenance(env, now))) return null;
  return Response.redirect(new URL("/maintenance", url), 307);
}
