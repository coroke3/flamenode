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
    } | null>;
  };
  VISIBILITY_KV?: {
    get: (key: string) => Promise<string | null>;
  };
  ROUTE_MANIFEST?: string | RouteManifest;
}

function parseManifest(raw: unknown): RouteManifest | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as RouteManifest;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as RouteManifest;
    } catch {
      return null;
    }
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

export default {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const manifest = parseManifest(env.ROUTE_MANIFEST);
    const revocationChecker = createKvRevocationChecker(env.VISIBILITY_KV);

    const decision = await evaluateVisibility(path, manifest, revocationChecker);

    if (decision.action === "bypass") {
      // Pass through or return 404 if no downstream bound
      return new Response("Auth endpoint handled by origin", { status: 404 });
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
      // 1. Try serving from Static Assets
      if (env.ASSETS) {
        const assetUrl = new URL(decision.assetPath, request.url);
        const assetRequest = new Request(assetUrl.toString(), request);
        const assetResponse = await env.ASSETS.fetch(assetRequest);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }
      }

      // 2. Try pre-generated R2 HTML if assets misses (D-06)
      if (env.R2_STORAGE) {
        const r2Key = decision.assetPath.replace(/^\//, "");
        const r2Object = await env.R2_STORAGE.get(r2Key);
        if (r2Object) {
          return new Response(r2Object.body, {
            status: 200,
            headers: {
              "Content-Type":
                r2Object.httpMetadata?.contentType ?? "text/html; charset=utf-8",
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
