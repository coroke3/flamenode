/**
 * Cloudflare visibility gateway entrypoint (MIG-0405 / Recipe R-GATEWAY / Runtime S1).
 * Thin Worker in front of Static Assets / prebuilt R2 HTML. Per request it reads at most
 * one route shard (Static Assets), one KV revocation entry and one R2 object (ZERO_1102.md S1).
 * A missing or unreadable R2 page answers 503 (an older-generation page is served and rebuilt) and asks for a rebuild (MIG-0406 U02).
 * Non-production PoC: no wrangler.toml, Route or Custom Domain uses it yet.
 */
import type { RouteResolution } from "../lib/routeMap.ts";
import { applyEdgePolicy, type EdgePolicyEnv } from "./edgePolicy.ts";
import { loadR2PrebuiltHtml, type R2HtmlBucket, type RebuildQueue, type ServeDecision } from "./r2Html.ts";
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

import {
  handlePageRenderQueue,
  type D1DatabaseLike,
  type PageRenderOutcome,
  type PageRenderR2Bucket,
  type QueueBatch,
} from "./pageRenderQueue.ts";

type Fetcher = { fetch: (request: Request) => Promise<Response> };

export interface GatewayEnv extends EdgePolicyEnv {
  /** Static Assets; must run with `run_worker_first = true` so every request passes this gate. */
  ASSETS?: Fetcher;
  /** Prebuilt HTML for pages that do not fit in Static Assets (MIG-0406, D-06); the MIG-0411 consumer writes it. */
  R2_STORAGE?: R2HtmlBucket & Partial<PageRenderR2Bucket>;
  /** Non-production only: rebuild requests for the MIG-0411 consumer. */
  REBUILD_QUEUE?: RebuildQueue;
  // Explicit service binding to the existing Auth.js origin; never return a fake auth 404.
  AUTH_ORIGIN?: Fetcher;
  VISIBILITY_KV?: {
    get: (key: string) => Promise<string | null>;
  };
  /** MIG-0411 consumer only: public_page_renders and the entity rows. Never read by fetch(). */
  DB?: D1DatabaseLike;
  /** MIG-0411 consumer only: comma-separated /_astro/*.css paths of the build (page stylesheet link). */
  PUBLIC_PAGE_STYLESHEETS?: string;
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

/**
 * Redirect Location: the target plus the incoming query. A target that has its own query
 * or fragment is merged as CURRENT Next merges redirect queries (prepare-destination.js:
 * `{ ...incoming, ...destination }`), so a key the target sets wins over the request's.
 */
function redirectLocation(targetPath: string, search: string): string {
  if (!search || !/[?#]/.test(targetPath)) return targetPath + search;
  const target = new URL(targetPath, "https://gateway.invalid");
  const own = new Set(target.searchParams.keys());
  for (const [key, value] of new URLSearchParams(search)) {
    if (!own.has(key)) target.searchParams.append(key, value);
  }
  return target.pathname + target.search + target.hash;
}

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

const EVENT_SLOTS_PATH = /^\/event\/[A-Za-z0-9_][A-Za-z0-9._-]{0,127}\/slots\/?$/;
const GROUP_SLUG_PATH = /^\/groups\/([^/]+)\/?$/;

/** CURRENT `/groups` -> `/event`, `/groups/{slug}` -> `/event#event-group-{slug}`; null otherwise. */
function groupCompatRedirect(path: string): string | null {
  if (path === "/groups" || path === "/groups/") return "/event";
  const match = GROUP_SLUG_PATH.exec(path);
  return match ? `/event#event-group-${match[1]}` : null;
}

type ExecutionContext = { waitUntil: (promise: Promise<unknown>) => void };

/** Static Assets first, then the prebuilt R2 HTML (D-06). */
async function servePage(
  decision: ServeDecision,
  request: Request,
  env: GatewayEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (env.ASSETS) {
    // Ask for the directory form: with the default html_handling
    // (auto-trailing-slash) `/x/index.html` and `/x` answer with a redirect.
    const assetUrl = new URL(`/${decision.key}/`, url.origin);
    let asset: Response;
    try {
      asset = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method, headers: request.headers, redirect: "manual" }));
    } catch {
      return unavailable();
    }
    if (asset.status === 200 || asset.status === 304) return asset;
    // Anything but a miss (a redirect, an error) is not known-good public HTML.
    if (asset.status !== 404) return unavailable();
  }

  // The route data says the page is public; without its HTML the answer is 503, not 404.
  if (!env.R2_STORAGE) return unavailable();
  const result = await loadR2PrebuiltHtml(env.R2_STORAGE, decision, request.method, env.REBUILD_QUEUE);
  if (result.rebuild) {
    if (ctx) ctx.waitUntil(result.rebuild);
    else await result.rebuild;
  }
  if (result.action === "serve") return result.response;
  return unavailable();
}

export default {
  async fetch(request: Request, env: GatewayEnv, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Edge policy first, in CURRENT middleware order (MIG-0619): canonical host 308, then
    // maintenance redirect. Auth.js and /api/health are reached only after it, as in CURRENT.
    const policy = await applyEdgePolicy(request, env);
    if (policy) return policy;

    // Auth.js stays on the existing origin, independent of route data and KV.
    if (path === "/api/auth" || path.startsWith("/api/auth/")) return forwardToAuth(request, env);

    // Public pages are read-only here; CURRENT Server Action POSTs need the Phase 6 APIs first.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return textResponse(405, "Method Not Allowed", { Allow: "GET, HEAD" });
    }
    // CURRENT group compat redirects (`app/(public)/groups/**`: redirect() = 307, query dropped).
    const group = groupCompatRedirect(path);
    if (group) {
      return new Response(null, { status: 307, headers: { Location: group, "Cache-Control": NO_STORE } });
    }
    if (!env.ASSETS) return unavailable();

    // `/event/{id}/slots`: Static Assets `_redirects` owns it (generated 307 to `/event/{id}`);
    // `redirect: "manual"` hands that answer to the client instead of following it here.
    if (EVENT_SLOTS_PATH.test(path)) {
      try {
        return await env.ASSETS.fetch(new Request(request, { redirect: "manual" }));
      } catch {
        return unavailable();
      }
    }

    // The maintenance page itself: static, and exempt from the maintenance redirect above.
    if (path === "/maintenance" || path === "/maintenance/") {
      try {
        return await env.ASSETS.fetch(
          new Request(new URL("/maintenance/", url.origin), { method: request.method, headers: request.headers, redirect: "manual" }),
        );
      } catch {
        return unavailable();
      }
    }

    // Fixed public pages and build assets: an exact allowlist, no route data or KV.
    const fixed = fixedPublicPath(path);
    if (fixed) {
      // Pages in directory form, as servePage does: with the default html_handling
      // `/about` would otherwise answer a redirect instead of the page.
      const target = FIXED_PUBLIC_PAGES.has(fixed) && fixed !== "/"
        ? new Request(new URL(`${fixed}/`, url.origin), { method: request.method, headers: request.headers, redirect: "manual" })
        : new Request(request, { redirect: "manual" });
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
            Location: redirectLocation(decision.targetPath, url.search),
            // The target may be unpublished at any time; never let a cache keep it.
            "Cache-Control": NO_STORE,
          },
        });
      case "deny":
        return notFound();
      case "unavailable":
        return unavailable();
      case "serve":
        return servePage(decision, request, env, ctx);
    }
  },
  /** MIG-0411: the REBUILD_QUEUE consumer (max_batch_size = 1, max_concurrency = 1). Non-production. */
  async queue(batch: QueueBatch, env: GatewayEnv): Promise<PageRenderOutcome[]> {
    const r2 = env.R2_STORAGE;
    const writable = r2?.put && r2.delete ? (r2 as PageRenderR2Bucket) : undefined;
    // Same shard lookup as fetch(): the Assets binding ignores the origin.
    const lookup: RouteLookup = env.ASSETS
      ? createShardLookup(env.ASSETS, "https://gateway.invalid")
      : async () => undefined;
    return handlePageRenderQueue(
      batch,
      { DB: env.DB, R2_STORAGE: writable, VISIBILITY_KV: env.VISIBILITY_KV, PUBLIC_PAGE_STYLESHEETS: env.PUBLIC_PAGE_STYLESHEETS },
      lookup,
    );
  },
};
