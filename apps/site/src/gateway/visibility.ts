/**
 * Visibility and route decision for the public gateway (MIG-0405 / Recipe R-GATEWAY / Runtime S1).
 * Pure: the caller supplies the route lookup (one shard) and the revocation check (one KV read).
 */
import type { RouteEntityKind, RouteResolution } from "../lib/routeMap.ts";
import { fixedPublicPath, isValidResolution, routeKeyFromPath } from "./routeShards.ts";

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

/** An alias may point at a legacy entry and so on; longer chains fail closed. */
export const MAX_REDIRECT_HOPS = 3;

type RedirectCheck =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; decision: GatewayDecision }>;

const NOT_FOUND = { action: "deny", status: 404, reason: "not_found" } as const;

/**
 * Follows a redirect target to its canonical entry (at most MAX_REDIRECT_HOPS route
 * lookups) and applies the same revocation fence as a canonical page, so an alias of
 * an unpublished page does not reveal or forward to it. A target that is a fixed
 * public page needs no lookup. Cycles, missing entries and over-long chains are 404.
 */
async function checkRedirectTarget(
  sourceKey: string,
  targetPath: string,
  lookup: RouteLookup,
  isRevoked: GatewayRevocationChecker,
): Promise<RedirectCheck> {
  const seen = new Set([sourceKey]);
  let path = targetPath;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    const pathname = path.split(/[?#]/, 1)[0];
    if (fixedPublicPath(pathname)) return { ok: true };
    const key = routeKeyFromPath(pathname);
    if (!key || seen.has(key)) return { ok: false, decision: NOT_FOUND };
    seen.add(key);
    const found = await lookup(key);
    if (!found) return { ok: false, decision: { action: "unavailable", status: 503, reason: "manifest_missing" } };
    const { resolution } = found;
    if (resolution === null) return { ok: false, decision: NOT_FOUND };
    if (!isValidResolution(resolution)) {
      return { ok: false, decision: { action: "unavailable", status: 503, reason: "manifest_corrupt" } };
    }
    if (resolution.type === "canonical") {
      if (await isRevoked(resolution.kind, resolution.id)) {
        return { ok: false, decision: { action: "deny", status: 404, reason: "revoked" } };
      }
      return { ok: true };
    }
    path = resolution.targetPath;
  }
  return { ok: false, decision: NOT_FOUND };
}

/**
 * Guarantee: anything not positively known to be public is a 404 or 503.
 * `/api/auth/*` and fixed public pages / assets never reach this function (index.ts
 * handles them first).
 */
export async function evaluateVisibility(
  pathname: string,
  lookup: RouteLookup,
  isRevoked: GatewayRevocationChecker | undefined,
): Promise<GatewayDecision> {
  const key = routeKeyFromPath(pathname);
  if (!key) return NOT_FOUND;

  const found = await lookup(key);
  if (!found) return { action: "unavailable", status: 503, reason: "manifest_missing" };
  const { resolution, generation } = found;
  if (resolution === null) return NOT_FOUND;
  if (!isValidResolution(resolution)) {
    return { action: "unavailable", status: 503, reason: "manifest_corrupt" };
  }

  // Without the revocation fence a page unpublished after the build could be served,
  // or forwarded to by one of its aliases.
  if (!isRevoked) return { action: "unavailable", status: 503, reason: "revocation_unavailable" };

  if (resolution.type === "redirect") {
    const check = await checkRedirectTarget(key, resolution.targetPath, lookup, isRevoked);
    if (!check.ok) return check.decision;
    return {
      action: "redirect",
      targetPath: resolution.targetPath,
      status: resolution.status,
      reason: resolution.reason,
    };
  }

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
