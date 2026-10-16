/**
 * Cloudflare visibility gateway entrypoint (MIG-0405 / Recipe R-GATEWAY / Runtime S1).
 * Thin Worker layer routing public requests to Static Assets / prebuilt R2 HTML.
 */
import type { RouteManifest } from "../lib/routeMap.ts";
import { evaluateVisibility, type GatewayRevocationChecker } from "./visibility.ts";

export interface GatewayEnv {
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  R2_STORAGE?: {
    get: (key: string) => Promise<{
      body: ReadableStream;
      httpMetadata?: { contentType?: string };
      customMetadata?: { generation?: string };
      size?: number;
    } | null>;
  };
  // Explicit service binding to the existing Auth.js origin; never return a fake auth 404.
  AUTH_ORIGIN?: { fetch: (request: Request) => Promise<Response> };
  VISIBILITY_KV?: {
    get: (key: string) => Promise<string | null>;
  };
  ROUTE_MANIFEST?: string | RouteManifest;
}

// Workers isolates are reused: deserialize a large manifest only on binding change.
let cachedRawManifest: string | undefined;
let cachedParsedManifest: RouteManifest | null = null;

function isValidManifest(value: unknown): value is RouteManifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<RouteManifest>;
  return m.schemaVersion === 1 && typeof m.generation === "string" &&
    m.generation.trim().length > 0 &&
    typeof m.sha256 === "string" && /^[a-f0-9]{64}$/i.test(m.sha256) &&
    Number.isSafeInteger(m.totalEntries) && (m.totalEntries ?? -1) >= 0 &&
    !!m.routes && typeof m.routes === "object" && !Array.isArray(m.routes);
}

function parseManifest(raw: unknown): RouteManifest | null {
  if (!raw) return null;
  if (typeof raw === "object") return isValidManifest(raw) ? raw : null;
  if (typeof raw === "string") {
    if (cachedRawManifest === raw) return cachedParsedManifest;
    try {
      const parsed: unknown = JSON.parse(raw);
      cachedParsedManifest = isValidManifest(parsed) ? parsed : null;
    } catch {
      cachedParsedManifest = null;
    }
    cachedRawManifest = raw;
    return cachedParsedManifest;
  }
  return null;
}

export function createKvRevocationChecker(
  kv?: { get: (key: string) => Promise<string | null> },
): GatewayRevocationChecker | undefined {
  if (!kv) return undefined;
  return async (kind: string, id: string): Promise<boolean> => {
    // D-09: Single KV read per request to check post-build revocation entry
    const value = await kv.get(`deny:${kind}:${id}`);
    return value !== null;
  };
}

function unavailableResponse(): Response {
  return new Response("Service Unavailable", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

// A single Worker binding object is stable within one request environment.
// Reuse its validated, parsed manifest instead of traversing megabytes of JSON per fetch.
const manifestByEnv = new WeakMap<GatewayEnv, { raw: unknown; parsed: RouteManifest | null }>();
function manifestForEnv(env: GatewayEnv): RouteManifest | null {
  const raw = env.ROUTE_MANIFEST;
  const cached = manifestByEnv.get(env);
  if (cached?.raw === raw) return cached.parsed;
  const parsed = parseManifest(raw);
  manifestByEnv.set(env, { raw, parsed });
  return parsed;
}

export default {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const manifest = manifestForEnv(env);
    const revocationChecker = createKvRevocationChecker(env.VISIBILITY_KV);

    // Missing a revocation fence must never expose prebuilt public HTML.
    // Keep auth passthrough independent of the manifest/fence.
    let decision;
    try {
      decision = await evaluateVisibility(path, manifest, revocationChecker);
    } catch {
      return unavailableResponse();
    }

    if (decision.action === "bypass") {
      if (!env.AUTH_ORIGIN) return unavailableResponse();
      try {
        return await env.AUTH_ORIGIN.fetch(request);
      } catch {
        return unavailableResponse();
      }
    }

    if (decision.action === "redirect") {
      return new Response(null, {
        status: decision.status,
        headers: {
          Location: decision.targetPath,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    if (decision.action === "unavailable") {
      return new Response("Service Unavailable", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store, private",
        },
      });
    }

    if (decision.action === "deny") {
      return new Response("Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...decision.headers,
        },
      });
    }

    if (decision.action === "serve") {
      if (!revocationChecker) return unavailableResponse();
      // 1. Try serving from Static Assets
      if (env.ASSETS) {
        const assetUrl = new URL(decision.assetPath, request.url);
        const assetRequest = new Request(assetUrl.toString(), request);
        try {
          const assetResponse = await env.ASSETS.fetch(assetRequest);
          if (assetResponse.status !== 404) return assetResponse;
        } catch {
          return unavailableResponse();
        }
      }

      // 2. Try pre-generated R2 HTML if assets misses (D-06)
      if (env.R2_STORAGE) {
        const r2Key = decision.assetPath.replace(/^\//, "");
        let r2Object;
        try {
          r2Object = await env.R2_STORAGE.get(r2Key);
        } catch {
          return unavailableResponse();
        }
        if (r2Object) {
          // A stale, untyped, or empty R2 object is not public content.
          if (r2Object.customMetadata?.generation !== manifest?.generation ||
              (r2Object.size !== undefined && r2Object.size <= 0) ||
              !r2Object.body ||
              !/^text\/html(?:\s*;|$)/i.test(r2Object.httpMetadata?.contentType ?? "")) {
            return unavailableResponse();
          }
          return new Response(r2Object.body, {
            status: 200,
            headers: {
              "Content-Type":
                r2Object.httpMetadata!.contentType!,
              "Cache-Control": "public, max-age=0, must-revalidate",
            },
          });
        }
      }

      // If neither asset nor R2 has the content, fail-closed 404
      return new Response("Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
