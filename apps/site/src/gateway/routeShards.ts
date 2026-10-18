/**
 * Route manifest shards for the public gateway (MIG-0405 / Runtime S1).
 *
 * The whole MIG-0404 manifest (~5 MB for 52k routes) costs ~76ms to JSON.parse
 * (PERF_HOTPATH_MATRIX.md), so the gateway never loads it. The build splits it
 * into ROUTE_SHARD_COUNT small JSON files under ROUTE_SHARD_DIR in Static Assets,
 * and a request reads only the one shard its key hashes to.
 *
 * Runs in the Worker and at build time: no Node built-ins.
 */
import type {
  RouteEntityKind,
  RouteManifest,
  RouteResolution,
} from "../lib/routeMap.ts";

export const ROUTE_SHARD_COUNT = 256;
export const ROUTE_SHARD_DIR = "/_fn/routes";

export type RouteShard = Readonly<{
  schemaVersion: 1;
  generation: string;
  shard: number;
  shardCount: number;
  routes: Readonly<Record<string, RouteResolution>>;
}>;

/** CURRENT `normalizeXId` (src/lib/utils/xid.ts): strip leading `@`, lower-case. */
export function normalizeUserId(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

/** The id CURRENT stores fences under: x_user ids are lower-cased (publicVisibilityFenceStore.ts). */
export function canonicalEntityId(kind: RouteEntityKind, id: string): string {
  return kind === "user" ? normalizeUserId(id) : id;
}

/** KV key of the post-build revocation entry. Writers must use this function too. */
export function revocationKey(kind: RouteEntityKind, id: string): string {
  return `deny:${kind}:${canonicalEntityId(kind, id)}`;
}

/** User slugs are case-insensitive and may carry `@`, like CURRENT `/user/[id]`. */
function normalizeKey(key: string): string {
  if (!key.startsWith("user/")) return key;
  const slug = key.slice("user/".length);
  return slug.includes("/") ? key : `user/${normalizeUserId(slug)}`;
}

const CONTROL_OR_SPACE = /[\u0000- \u007f]/;

/**
 * Request pathname (percent-encoded, as in `new URL().pathname`) to manifest key.
 * Returns null for anything that cannot be a public route; the caller answers 404.
 */
export function routeKeyFromPath(pathname: string): string | null {
  if (typeof pathname !== "string") return null;
  // An encoded `/`, `\` or `.` could smuggle a segment past the checks below.
  if (/%2f|%5c|%2e/i.test(pathname)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("//")) return null;
  if (CONTROL_OR_SPACE.test(decoded)) return null;
  const key = decoded.replace(/^\//, "").replace(/\/$/, "");
  return key ? normalizeKey(key) : null;
}

/**
 * Fixed public pages (CURRENT `app/(public)/<segment>/page.tsx` without a dynamic
 * segment) and public build assets. Only these exact, normalised paths bypass the
 * route shards and go straight to Static Assets; detail pages (`/<id>`,
 * `/user/<id>`, `/event/<id>`, `/groups/<slug>`) and everything else never do.
 * A test checks the pages against CURRENT `app/(public)` and RESERVED_ROOT_SLUGS.
 */
export const FIXED_PUBLIC_PAGES: ReadonlySet<string> = new Set([
  "/",
  "/about",
  "/event",
  "/groups",
  "/list",
  "/recommend",
  "/rules",
  "/trending",
  "/user",
]);
/** Files copied from CURRENT `public/` (not `_headers`, which is configuration). */
export const PUBLIC_ASSET_FILES: ReadonlySet<string> = new Set([
  "/favicon.ico",
  "/logo.png",
  "/manifest.webmanifest",
  "/robots.txt",
]);
/** Hashed Astro build output and CURRENT `public/brand/`. Never `ROUTE_SHARD_DIR`. */
export const PUBLIC_ASSET_PREFIXES: readonly string[] = ["/_astro/", "/brand/"];
const ASSET_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MAX_STATIC_PATH_LENGTH = 256;

/**
 * Request pathname (as in `new URL().pathname`) to the Static Assets path it may be
 * served from without a route lookup, or null. Percent-encoding, `..`, `\\`, `//`
 * and dot-files are rejected outright, so nothing can be smuggled past the list.
 */
export function fixedPublicPath(pathname: string): string | null {
  if (typeof pathname !== "string" || pathname.length > MAX_STATIC_PATH_LENGTH) return null;
  if (!pathname.startsWith("/") || pathname.includes("%") || pathname.includes("\\") ||
      pathname.includes("//") || pathname.includes("..") || CONTROL_OR_SPACE.test(pathname)) {
    return null;
  }
  const page = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (FIXED_PUBLIC_PAGES.has(page)) return page;
  if (PUBLIC_ASSET_FILES.has(pathname)) return pathname;
  for (const prefix of PUBLIC_ASSET_PREFIXES) {
    if (!pathname.startsWith(prefix)) continue;
    const segments = pathname.slice(prefix.length).split("/");
    return segments.every((segment) => ASSET_SEGMENT.test(segment)) ? pathname : null;
  }
  return null;
}

/** 32-bit FNV-1a over UTF-16 code units; stable between build and Worker. */
export function shardIndexForKey(key: string, shardCount = ROUTE_SHARD_COUNT): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % shardCount;
}

export function shardAssetPath(index: number): string {
  return `${ROUTE_SHARD_DIR}/${index}.json`;
}

/**
 * Build step: split a manifest into shard files. Throws when two user routes
 * differ only by case, since the gateway could not tell them apart.
 */
export function buildRouteShards(
  manifest: RouteManifest,
  shardCount = ROUTE_SHARD_COUNT,
): { path: string; body: string }[] {
  const shards: Record<string, RouteResolution>[] = Array.from(
    { length: shardCount },
    () => Object.create(null),
  );
  for (const rawKey of Object.keys(manifest.routes)) {
    const key = normalizeKey(rawKey);
    const shard = shards[shardIndexForKey(key, shardCount)];
    if (Object.hasOwn(shard, key)) {
      throw new Error(`ROUTE_SHARD_COLLISION: '${rawKey}' collides with another route after normalisation`);
    }
    shard[key] = manifest.routes[rawKey];
  }
  return shards.map((routes, shard) => ({
    path: shardAssetPath(shard),
    body: JSON.stringify({
      schemaVersion: 1,
      generation: manifest.generation,
      shard,
      shardCount,
      routes,
    } satisfies RouteShard),
  }));
}

const KINDS: ReadonlySet<string> = new Set(["video", "user", "event"]);
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 307, 308]);

function isSameSitePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") &&
    !CONTROL_OR_SPACE.test(value) && !value.includes("\\");
}

export function isValidResolution(value: unknown): value is RouteResolution {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (r.type === "canonical") {
    return typeof r.kind === "string" && KINDS.has(r.kind) && typeof r.id === "string" &&
      r.id.length > 0 && isSameSitePath(r.canonicalPath);
  }
  if (r.type === "redirect") {
    return isSameSitePath(r.targetPath) && typeof r.status === "number" &&
      REDIRECT_STATUSES.has(r.status) && (r.reason === "alias" || r.reason === "legacy");
  }
  return false;
}

/** Validates the shard envelope; entries are validated when looked up. */
export function parseRouteShard(raw: string, expectedIndex: number): RouteShard | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<RouteShard>;
  if (s.schemaVersion !== 1 || typeof s.generation !== "string" || !s.generation.trim() ||
      s.shard !== expectedIndex || s.shardCount !== ROUTE_SHARD_COUNT ||
      !s.routes || typeof s.routes !== "object" || Array.isArray(s.routes)) {
    return null;
  }
  return s as RouteShard;
}
