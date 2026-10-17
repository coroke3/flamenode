/**
 * Visibility and route decision for the public gateway (MIG-0405 / Recipe R-GATEWAY / Runtime S1).
 * Pure: the caller supplies the route lookup (one shard) and the revocation check (one KV read).
 */
import type { RouteEntityKind, RouteResolution } from "../lib/routeMap.ts";
import { isValidResolution, routeKeyFromPath } from "./routeShards.ts";

export type GatewayRevocationChecker = (
  kind: RouteEntityKind,
  id: string,
) => boolean | Promise<boolean>;

/** Resolves a manifest key. `undefined` means the route data itself is unavailable. */
export type RouteLookup = (
  key: string,
) => Promise<Readonly<{ resolution: RouteResolution | null; generation: string }> | undefined>;

export type GatewayDecision =
  | Readonly<{
      action: "serve";
      kind: RouteEntityKind;
      id: string;
      key: string;
      canonicalPath: string;
      generation: string;
    }>
  | Readonly<{
      action: "redirect";
      targetPath: string;
      status: 301 | 302 | 307 | 308;
      reason: "alias" | "legacy";
    }>
  | Readonly<{
      action: "deny";
      status: 404;
      reason: "not_found" | "revoked";
    }>
  | Readonly<{
      action: "unavailable";
      status: 503;
      reason: "manifest_missing" | "manifest_corrupt" | "revocation_unavailable";
    }>;

/**
 * Guarantee: anything not positively known to be public is a 404 or 503.
 * `/api/auth/*` never reaches this function (index.ts forwards it first).
 */
export async function evaluateVisibility(
  pathname: string,
  lookup: RouteLookup,
  isRevoked: GatewayRevocationChecker | undefined,
): Promise<GatewayDecision> {
  const key = routeKeyFromPath(pathname);
  if (!key) return { action: "deny", status: 404, reason: "not_found" };

  const found = await lookup(key);
  if (!found) return { action: "unavailable", status: 503, reason: "manifest_missing" };
  const { resolution, generation } = found;
  if (resolution === null) return { action: "deny", status: 404, reason: "not_found" };
  if (!isValidResolution(resolution)) {
    return { action: "unavailable", status: 503, reason: "manifest_corrupt" };
  }

  if (resolution.type === "redirect") {
    return {
      action: "redirect",
      targetPath: resolution.targetPath,
      status: resolution.status,
      reason: resolution.reason,
    };
  }

  // Without the revocation fence a page unpublished after the build could be served.
  if (!isRevoked) return { action: "unavailable", status: 503, reason: "revocation_unavailable" };
  if (await isRevoked(resolution.kind, resolution.id)) {
    return { action: "deny", status: 404, reason: "revoked" };
  }
  return {
    action: "serve",
    kind: resolution.kind,
    id: resolution.id,
    key,
    canonicalPath: resolution.canonicalPath,
    generation,
  };
}
