/**
 * Cloudflare visibility gateway entrypoint (MIG-0405 / Recipe R-GATEWAY / Runtime S1).
 * Thin Worker in front of Static Assets / prebuilt R2 HTML. Per request it reads at most
 * one route shard (Static Assets), one KV revocation entry and one R2 object (ZERO_1102.md S1).
 * Non-production PoC: no wrangler.toml, Route or Custom Domain uses it yet.
 */
import type { RouteResolution } from "../lib/routeMap.ts";
import {
  FIXED_PUBLIC_PAGES,
  fixedPublicPath,
  parseRouteShard,
  revocationKey,
  shardAssetPath,
  shardIndexForKey,
  type RouteShard,
} from "./routeShards.ts";
import {
  evaluateVisibility,
  type GatewayDecision,
  type GatewayRevocationChecker,
  type RouteLookup,
} from "./visibility.ts";

type Fetcher = { fetch: (request: Request) => Promise<Response> };

export interface GatewayEnv {
  /** Static Assets; must run with `run_worker_first = true` so every request passes this gate. */
  ASSETS?: Fetcher;
  R2_STORAGE?: {
    get: (key: string) => Promise<{
      body: ReadableStream;
      httpMetadata?: { contentType?: string };
      customMetadata?: { generation?: string };
      size?: number;
    } | null>;
  };
  // Explicit service binding to the existing Auth.js origin; never return a fake auth 404.
  AUTH_ORIGIN?: Fetcher;
  VISIBILITY_KV?: {
    get: (key: string) => Promise<string | null>;
  };
}

const NO_STORE = "no-store, private";
const NOINDEX = "noindex, nofollow";

function textResponse(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": NO_STORE,
      "X-Robots-Tag": NOINDEX,
      ...extra,
    },
  });
}

const unavailable = () => textResponse(503, "Service Unavailable");
const notFound = () => textResponse(404, "Not Found");

// Parsed shards are small (~20 KB at 52k routes); keep a bounded number per isolate.
// A shard belongs to one Static Assets version, so it cannot go stale within an isolate.
const SHARD_CACHE_LIMIT = 64;
const shardCache = new Map<number, RouteShard>();

function rememberShard(index: number, shard: RouteShard): void {
  if (shardCache.size >= SHARD_CACHE_LIMIT) {
    const oldest = shardCache.keys().next().value;
    if (oldest !== undefined) shardCache.delete(oldest);
  }
  shardCache.set(index, shard);
}

/** Test hook: forget cached shards so each test starts cold. */
export function resetGatewayCaches(): void {
  shardCache.clear();
}

function createShardLookup(assets: Fetcher, origin: string): RouteLookup {
  return async (key) => {
    const index = shardIndexForKey(key);
    let shard = shardCache.get(index);
    if (!shard) {
      let response: Response;
      try {
        response = await assets.fetch(new Request(new URL(shardAssetPath(index), origin)));
      } catch {
        return undefined;
      }
      if (response.status !== 200) return undefined;
      const parsed = parseRouteShard(await response.text(), index);
      if (!parsed) return undefined;
      shard = parsed;
      rememberShard(index, shard);
    }
    const resolution: RouteResolution | null = Object.hasOwn(shard.routes, key)
      ? shard.routes[key]
      : null;
    return { resolution, generation: shard.generation };
  };
}

export function createKvRevocationChecker(
  kv?: { get: (key: string) => Promise<string | null> },
): GatewayRevocationChecker | undefined {
  if (!kv) return undefined;
  // D-09: one KV read per served page for the post-build revocation entry.
  return async (kind, id) => (await kv.get(revocationKey(kind, id))) !== null;
}

async function forwardToAuth(request: Request, env: GatewayEnv): Promise<Response> {
  if (!env.AUTH_ORIGIN) return unavailable();
  try {
    return await env.AUTH_ORIGIN.fetch(request);
  } catch {
    return unavailable();
  }
}

/** Static Assets first, then the prebuilt R2 HTML (D-06). */
async function servePage(
  decision: Extract<GatewayDecision, { action: "serve" }>,
  request: Request,
  env: GatewayEnv,
): Promise<Response> {
  const url = new URL(request.url);
  if (env.ASSETS) {
    // Ask for the directory form: with the default html_handling
    // (auto-trailing-slash) `/x/index.html` and `/x` answer with a redirect.
    const assetUrl = new URL(`/${decision.key}/`, url.origin);
    let asset: Response;
    try {
      asset = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method, headers: request.headers }));
    } catch {
      return unavailable();
    }
    if (asset.status === 200 || asset.status === 304) return asset;
    // Anything but a miss (a redirect, an error) is not known-good public HTML.
    if (asset.status !== 404) return unavailable();
  }

  if (env.R2_STORAGE) {
    let object;
    try {
      object = await env.R2_STORAGE.get(`${decision.key}/index.html`);
    } catch {
      return unavailable();
    }
    if (object) {
      // A stale, untyped, or empty R2 object is not public content.
      const contentType = object.httpMetadata?.contentType ?? "";
      if (object.customMetadata?.generation !== decision.generation ||
          !Number.isFinite(object.size) || (object.size ?? 0) <= 0 || !object.body ||
          !/^text\/html(?:\s*;|$)/i.test(contentType)) {
        return unavailable();
      }
      return new Response(request.method === "HEAD" ? null : object.body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=0, must-revalidate",
        },
      });
    }
  }
  return notFound();
}

export default {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Auth.js stays on the existing origin, independent of route data and KV.
    if (path === "/api/auth" || path.startsWith("/api/auth/")) return forwardToAuth(request, env);

    // Public pages are read-only here; CURRENT Server Action POSTs need the Phase 6 APIs first.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse(405, "Method Not Allowed", { Allow: "GET, HEAD" });
    }
    if (!env.ASSETS) return unavailable();

    // Fixed public pages and build assets: an exact allowlist, no route data or KV.
    const fixed = fixedPublicPath(path);
    if (fixed) {
      // Pages in directory form, as servePage does: with the default html_handling
      // `/about` would otherwise answer a redirect instead of the page.
      const target = FIXED_PUBLIC_PAGES.has(fixed) && fixed !== "/"
        ? new Request(new URL(`${fixed}/`, url.origin), { method: request.method, headers: request.headers })
        : request;
      try {
        return await env.ASSETS.fetch(target);
      } catch {
        return unavailable();
      }
    }
    if (!env.VISIBILITY_KV) return unavailable();

    let decision: GatewayDecision;
    try {
      decision = await evaluateVisibility(
        path,
        createShardLookup(env.ASSETS, url.origin),
        createKvRevocationChecker(env.VISIBILITY_KV),
      );
    } catch {
      return unavailable();
    }

    switch (decision.action) {
      case "redirect":
        return new Response(null, {
          status: decision.status,
          headers: {
            // Keep the query, as CURRENT Next redirects do (e.g. `?tab=works`).
            Location: decision.targetPath + url.search,
            // The target may be unpublished at any time; never let a cache keep it.
            "Cache-Control": NO_STORE,
          },
        });
      case "deny":
        return notFound();
      case "unavailable":
        return unavailable();
      case "serve":
        return servePage(decision, request, env);
    }
  },
};
