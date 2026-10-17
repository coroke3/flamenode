/**
 * Prebuilt R2 HTML for pages that do not fit in Static Assets (MIG-0406 / D-06 / Runtime S1).
 * Only called for a `serve` decision, so visibility and the revocation fence are
 * already checked (visibility.ts). Here: one R2 GET, and a rebuild request when the
 * HTML is missing, stale or unreadable. Nothing is rendered during the request.
 */
import type { GatewayDecision } from "./visibility.ts";

export type ServeDecision = Extract<GatewayDecision, { action: "serve" }>;

export type R2HtmlBucket = {
  get: (key: string) => Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
    customMetadata?: { generation?: string };
    size?: number;
  } | null>;
};

/** Message for the MIG-0411 consumer. Non-production: no queue is bound yet. */
export type RebuildRequest = Readonly<{
  type: "rebuild-page";
  key: string;
  kind: ServeDecision["kind"];
  id: string;
  generation: string;
  reason: R2HtmlFailure;
}>;

export type RebuildQueue = { send: (message: RebuildRequest) => Promise<unknown> };

export type R2HtmlFailure = "html_missing" | "stale_generation" | "corrupt_data" | "r2_read_failed";

export type R2HtmlResult =
  | Readonly<{ action: "serve"; response: Response }>
  | Readonly<{ action: "unavailable"; reason: R2HtmlFailure; rebuild?: Promise<void> }>;

export function r2HtmlKey(key: string): string {
  return `${key}/index.html`;
}

// A missing page is requested by every visitor until it is rebuilt; ask once per
// key per isolate per minute. The MIG-0411 consumer must still deduplicate.
const REBUILD_INTERVAL_MS = 60_000;
const REBUILD_MEMORY_LIMIT = 256;
const recentRebuilds = new Map<string, number>();

/** Test hook: forget rebuild requests so each test starts clean. */
export function resetRebuildMemory(): void {
  recentRebuilds.clear();
}

function requestRebuild(
  queue: RebuildQueue | undefined,
  decision: ServeDecision,
  reason: R2HtmlFailure,
  now: number,
): Promise<void> | undefined {
  if (!queue) return undefined;
  const last = recentRebuilds.get(decision.key);
  if (last !== undefined && now - last < REBUILD_INTERVAL_MS) return undefined;
  if (recentRebuilds.size >= REBUILD_MEMORY_LIMIT) {
    const oldest = recentRebuilds.keys().next().value;
    if (oldest !== undefined) recentRebuilds.delete(oldest);
  }
  recentRebuilds.delete(decision.key);
  recentRebuilds.set(decision.key, now);
  const message: RebuildRequest = {
    type: "rebuild-page",
    key: decision.key,
    kind: decision.kind,
    id: decision.id,
    generation: decision.generation,
    reason,
  };
  // A failed send must not change the answer, which is already a 503.
  return queue.send(message).then(() => undefined, () => undefined);
}

export async function loadR2PrebuiltHtml(
  r2: R2HtmlBucket,
  decision: ServeDecision,
  method: string,
  queue?: RebuildQueue,
  now = Date.now(),
): Promise<R2HtmlResult> {
  const fail = (reason: R2HtmlFailure): R2HtmlResult => ({
    action: "unavailable",
    reason,
    rebuild: requestRebuild(queue, decision, reason, now),
  });

  let object;
  try {
    object = await r2.get(r2HtmlKey(decision.key));
  } catch {
    return fail("r2_read_failed");
  }
  // The route data says the page is public, so a missing page is a build gap, not a 404.
  if (!object) return fail("html_missing");
  // HTML from another build may predate an unpublish or a slug change.
  if (object.customMetadata?.generation !== decision.generation) return fail("stale_generation");
  const contentType = object.httpMetadata?.contentType ?? "";
  if (!object.body || !Number.isFinite(object.size) || (object.size ?? 0) <= 0 ||
      !/^text\/html(?:\s*;|$)/i.test(contentType)) {
    return fail("corrupt_data");
  }
  // HEAD sends no body; release the R2 stream instead of leaving it open.
  if (method === "HEAD") await Promise.resolve(object.body.cancel?.()).catch(() => undefined);
  return {
    action: "serve",
    response: new Response(method === "HEAD" ? null : object.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    }),
  };
}
