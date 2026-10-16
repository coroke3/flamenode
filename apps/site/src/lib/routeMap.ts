/**
 * Build-time route-map table generator and lookup (MIG-0404 / Recipe R-BUILD / Runtime N).
 * Resolves canonical, alias, and legacy routes deterministically without request-time D1 scans.
 */
import { createHash } from "node:crypto";

export type RouteEntityKind = "video" | "user" | "event";
export type RedirectStatus = 301 | 302 | 307 | 308;

export type EntityRouteEntry = Readonly<{
  kind: RouteEntityKind;
  id: string;
  aliases?: readonly string[];
}>;

export type LegacyRedirectEntry = Readonly<{
  kind: "redirect";
  fromPath: string;
  toPath: string;
  status?: RedirectStatus;
}>;

export type RouteInputEntry = EntityRouteEntry | LegacyRedirectEntry;

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
      status: RedirectStatus;
      reason: "alias" | "legacy";
    }>;

export type RouteManifest = Readonly<{
  schemaVersion: 1;
  generation: string;
  sha256: string;
  totalEntries: number;
  routes: Readonly<Record<string, RouteResolution>>;
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

function hasTraversal(value: string): boolean {
  return value.includes("..") || value.includes("\\") || /%2f|%2e|%5c/i.test(value);
}

export function validateRouteId(id: string): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidRouteIdError(String(id), "ID must be a non-empty string");
  }
  if (hasTraversal(id) || id.includes("/")) {
    throw new InvalidRouteIdError(id, "ID contains forbidden traversal or path characters");
  }
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new InvalidRouteIdError(id, "ID does not match allowed pattern");
  }
  return id;
}

export function normalizeLookupPath(pathOrSlug: string): string {
  return pathOrSlug.trim().replace(/^\//, "").replace(/\/$/, "");
}

function assertRootSlugFree(slug: string): void {
  if (RESERVED_ROOT_SLUGS.has(slug) || RESERVED_ASSET_PATHS.has(slug)) {
    throw new RouteCollisionError(slug, "collides with reserved root route or asset");
  }
}

/** Key in the manifest for an entity slug: root for videos, `user/` and `event/` otherwise. */
function entityKey(kind: RouteEntityKind, slug: string): string {
  if (kind === "video") {
    assertRootSlugFree(slug);
    return slug;
  }
  return `${kind}/${slug}`;
}

/** Legacy source paths obey the same rules as entity keys, so they cannot shadow fixed routes. */
function legacyKey(fromPath: string): string {
  const key = normalizeLookupPath(fromPath);
  const segments = key.split("/");
  if (key.length === 0 || segments.some((s) => s.length === 0)) {
    throw new InvalidRouteIdError(fromPath, "legacy path must be a non-empty path");
  }
  for (const segment of segments) validateRouteId(segment);
  if (segments.length === 1) assertRootSlugFree(key);
  return key;
}

/** Redirect targets must stay on this site: a path, never `//host` or a full URL. */
function validateRedirectTarget(toPath: string): string {
  if (
    typeof toPath !== "string" ||
    !toPath.startsWith("/") ||
    toPath.startsWith("//") ||
    hasTraversal(toPath)
  ) {
    throw new InvalidRouteIdError(String(toPath), "redirect target must be a same-site path");
  }
  return toPath;
}

export function buildRouteMap(
  entries: readonly RouteInputEntry[],
  generation: string,
): RouteManifest {
  if (typeof generation !== "string" || generation.trim().length === 0) {
    throw new RouteMapError("INVALID_GENERATION", "Generation must be a non-empty string");
  }

  // Map, not a plain object: keys such as `constructor` must not hit Object.prototype.
  const routes = new Map<string, RouteResolution>();
  const add = (key: string, resolution: RouteResolution) => {
    if (routes.has(key)) throw new DuplicateRouteError(key);
    routes.set(key, resolution);
  };

  for (const entry of entries) {
    if (entry.kind === "redirect") {
      add(legacyKey(entry.fromPath), {
        type: "redirect",
        targetPath: validateRedirectTarget(entry.toPath),
        status: entry.status ?? 307,
        reason: "legacy",
      });
      continue;
    }

    const id = validateRouteId(entry.id);
    const key = entityKey(entry.kind, id);
    const canonicalPath = `/${key}`;
    add(key, { type: "canonical", kind: entry.kind, id, canonicalPath });

    for (const alias of entry.aliases ?? []) {
      add(entityKey(entry.kind, validateRouteId(alias)), {
        type: "redirect",
        targetPath: canonicalPath,
        status: 308,
        reason: "alias",
      });
    }
  }

  const sortedRoutes: Record<string, RouteResolution> = {};
  for (const key of [...routes.keys()].sort()) {
    sortedRoutes[key] = routes.get(key)!;
  }
  const sha256 = createHash("sha256").update(JSON.stringify(sortedRoutes)).digest("hex");

  return {
    schemaVersion: 1,
    generation,
    sha256,
    totalEntries: routes.size,
    routes: sortedRoutes,
  };
}

/** Returns null for anything not in the manifest; the caller answers 404. */
export function lookupRoute(
  manifest: RouteManifest,
  pathOrSlug: string,
): RouteResolution | null {
  if (typeof pathOrSlug !== "string" || hasTraversal(pathOrSlug)) {
    return null;
  }
  const key = normalizeLookupPath(pathOrSlug);
  if (!key || !Object.hasOwn(manifest.routes, key)) {
    return null;
  }
  return manifest.routes[key];
}
