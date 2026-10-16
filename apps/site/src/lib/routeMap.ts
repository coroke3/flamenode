/**
 * Build-time route-map table generator and lookup (MIG-0404 / Recipe R-BUILD / Runtime N).
 * Resolves canonical, alias, and legacy routes deterministically without request-time D1 scans.
 */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

export type RouteEntityKind = "video" | "user" | "event";

export type VideoRouteEntry = Readonly<{
  kind: "video";
  id: string;
  aliases?: readonly string[];
}>;

export type UserRouteEntry = Readonly<{
  kind: "user";
  id: string;
  aliases?: readonly string[];
}>;

export type EventRouteEntry = Readonly<{
  kind: "event";
  id: string;
  aliases?: readonly string[];
}>;

export type LegacyRedirectEntry = Readonly<{
  kind: "redirect";
  fromPath: string;
  toPath: string;
  status?: 301 | 302 | 307 | 308;
}>;

export type RouteInputEntry =
  | VideoRouteEntry
  | UserRouteEntry
  | EventRouteEntry
  | LegacyRedirectEntry;

export type RouteResolution =
  | Readonly<{
      type: "canonical";
      kind: RouteEntityKind;
      id: string;
      canonicalPath: string;
    }>
  | Readonly<{
      type: "redirect";
      targetPath: string;
      status: 301 | 302 | 307 | 308;
      reason: "alias" | "legacy";
    }>;

export type RouteManifest = Readonly<{
  schemaVersion: 1;
  generation: string;
  sha256: string;
  totalEntries: number;
  routes: Readonly<Record<string, RouteResolution>>;
}>;

export type RouteMapMetrics = Readonly<{
  totalEntries: number;
  manifestBytes: number;
  lookupP99CpuMs: number;
  lookupMaxCpuMs: number;
}>;

export class RouteMapError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RouteMapError";
  }
}

export class RouteCollisionError extends RouteMapError {
  constructor(slug: string, reason: string) {
    super("ROUTE_COLLISION", `Route collision for slug '${slug}': ${reason}`);
    this.name = "RouteCollisionError";
  }
}

export class DuplicateRouteError extends RouteMapError {
  constructor(slug: string) {
    super("DUPLICATE_ROUTE", `Duplicate route entry for slug '${slug}'`);
    this.name = "DuplicateRouteError";
  }
}

export class InvalidRouteIdError extends RouteMapError {
  constructor(id: string, reason: string) {
    super("INVALID_ROUTE_ID", `Invalid route ID '${id}': ${reason}`);
    this.name = "InvalidRouteIdError";
  }
}

export const RESERVED_ROOT_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "rules",
  "event",
  "user",
  "list",
  "recommend",
  "trending",
  "groups",
  "admin",
  "manage",
  "dashboard",
  "entry",
  "api",
  "auth",
  "maintenance",
]);

export const RESERVED_ASSET_PATHS: ReadonlySet<string> = new Set([
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "manifest.json",
  "_astro",
  "_next",
  "assets",
  "public",
]);

const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export function validateRouteId(id: string): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidRouteIdError(String(id), "ID must be a non-empty string");
  }
  // Check for path traversal or encoded slashes
  if (
    id.includes("..") ||
    id.includes("/") ||
    id.includes("\\") ||
    /%2f|%2e/i.test(id)
  ) {
    throw new InvalidRouteIdError(id, "ID contains forbidden traversal or path characters");
  }
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new InvalidRouteIdError(id, "ID does not match allowed pattern");
  }
  return id;
}

export function normalizeLookupPath(pathOrSlug: string): string {
  let cleaned = pathOrSlug.trim();
  if (cleaned.startsWith("/")) {
    cleaned = cleaned.slice(1);
  }
  if (cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

export function buildRouteMap(
  entries: readonly RouteInputEntry[],
  generation: string,
): RouteManifest {
  if (typeof generation !== "string" || generation.trim().length === 0) {
    throw new RouteMapError("INVALID_GENERATION", "Generation must be a non-empty string");
  }

  const routes: Record<string, RouteResolution> = {};

  for (const entry of entries) {
    if (entry.kind === "redirect") {
      const fromKey = normalizeLookupPath(entry.fromPath);
      if (routes[fromKey]) {
        throw new DuplicateRouteError(fromKey);
      }
      routes[fromKey] = {
        type: "redirect",
        targetPath: entry.toPath,
        status: entry.status ?? 307,
        reason: "legacy",
      };
      continue;
    }

    const validatedId = validateRouteId(entry.id);

    // Root video uses root slug `/[id]`. User uses `/user/[id]`. Event uses `/event/[id]`.
    let canonicalKey: string;
    let canonicalPath: string;

    if (entry.kind === "video") {
      if (RESERVED_ROOT_SLUGS.has(validatedId) || RESERVED_ASSET_PATHS.has(validatedId)) {
        throw new RouteCollisionError(validatedId, "Video slug collides with reserved root route or asset");
      }
      canonicalKey = validatedId;
      canonicalPath = `/${validatedId}`;
    } else if (entry.kind === "user") {
      canonicalKey = `user/${validatedId}`;
      canonicalPath = `/user/${validatedId}`;
    } else {
      canonicalKey = `event/${validatedId}`;
      canonicalPath = `/event/${validatedId}`;
    }

    if (routes[canonicalKey]) {
      throw new DuplicateRouteError(canonicalKey);
    }

    routes[canonicalKey] = {
      type: "canonical",
      kind: entry.kind,
      id: validatedId,
      canonicalPath,
    };

    if (entry.aliases) {
      for (const rawAlias of entry.aliases) {
        const validatedAlias = validateRouteId(rawAlias);
        let aliasKey: string;
        if (entry.kind === "video") {
          if (RESERVED_ROOT_SLUGS.has(validatedAlias) || RESERVED_ASSET_PATHS.has(validatedAlias)) {
            throw new RouteCollisionError(validatedAlias, "Video alias collides with reserved root route or asset");
          }
          aliasKey = validatedAlias;
        } else if (entry.kind === "user") {
          aliasKey = `user/${validatedAlias}`;
        } else {
          aliasKey = `event/${validatedAlias}`;
        }

        if (routes[aliasKey]) {
          throw new DuplicateRouteError(aliasKey);
        }

        routes[aliasKey] = {
          type: "redirect",
          targetPath: canonicalPath,
          status: 308,
          reason: "alias",
        };
      }
    }
  }

  // Deterministic sorting of keys
  const sortedKeys = Object.keys(routes).sort();
  const sortedRoutes: Record<string, RouteResolution> = {};
  for (const k of sortedKeys) {
    sortedRoutes[k] = routes[k];
  }

  const payloadString = JSON.stringify(sortedRoutes);
  const sha256 = createHash("sha256").update(payloadString).digest("hex");

  return {
    schemaVersion: 1,
    generation,
    sha256,
    totalEntries: sortedKeys.length,
    routes: sortedRoutes,
  };
}

export function lookupRoute(
  manifest: RouteManifest,
  pathOrSlug: string,
): RouteResolution | null {
  if (typeof pathOrSlug !== "string") {
    return null;
  }

  // Traversal and encoding sanity check
  if (
    pathOrSlug.includes("..") ||
    /%2f|%2e/i.test(pathOrSlug) ||
    pathOrSlug.includes("\\")
  ) {
    return null;
  }

  const key = normalizeLookupPath(pathOrSlug);
  if (!key) {
    return null;
  }

  return manifest.routes[key] ?? null;
}

export function measureRouteMapMetrics(
  manifest: RouteManifest,
  lookupSampleKeys: readonly string[],
  iterations = 10000,
): RouteMapMetrics {
  const json = JSON.stringify(manifest);
  const manifestBytes = Buffer.byteLength(json, "utf-8");

  if (lookupSampleKeys.length === 0) {
    return {
      totalEntries: manifest.totalEntries,
      manifestBytes,
      lookupP99CpuMs: 0,
      lookupMaxCpuMs: 0,
    };
  }

  const sampleCount = lookupSampleKeys.length;

  // Warm up JIT
  for (let i = 0; i < 100; i++) {
    lookupRoute(manifest, lookupSampleKeys[i % sampleCount]);
  }

  const timings: number[] = new Array(iterations);

  for (let i = 0; i < iterations; i++) {
    const key = lookupSampleKeys[i % sampleCount];
    const start = performance.now();
    lookupRoute(manifest, key);
    timings[i] = performance.now() - start;
  }

  timings.sort((a, b) => a - b);
  const p99Index = Math.floor(iterations * 0.99);
  const lookupP99CpuMs = timings[Math.min(p99Index, iterations - 1)];
  const lookupMaxCpuMs = timings[iterations - 1];

  return {
    totalEntries: manifest.totalEntries,
    manifestBytes,
    lookupP99CpuMs,
    lookupMaxCpuMs,
  };
}
