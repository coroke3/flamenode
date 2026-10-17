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
