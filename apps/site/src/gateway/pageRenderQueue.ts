/**
 * Queue consumer: visibility-fenced DELETE and tracker closure (MIG-0411 / D-11).
 * No HTML generation or R2 PUT is permitted. It reads the route shards
 * (Static Assets) to verify the canonical identity of a page:
 *   key  = r2HtmlKey(<route key>)            e.g. `abc/index.html`, `user/x/index.html`
 *   meta = { kind, id, key, generation }   id = internal row id (videos.id), key = route key
 *          (video: the YouTube id slug); the gateway serves on kind/id/key, generation is diagnostic
 *
 * Accepted messages (anything else is acked as invalid):
 *   - RebuildRequest from r2Html.ts (gateway, HTML missing / stale / unreadable)
 *   - PageRenderDoorbell `{ type: "render-page", kind, id }` (update API S3, recovery)
 *
 * Producer contract (update API S3): in the same D1 batch as the entity write, run
 * `requestPageRenderStatement` (adds 1 to request_version), then send one doorbell after
 * the commit. NOT WIRED: no CURRENT update path calls it yet (see the work item).
 *
 * Versions, not timestamps: the tracker CAS is `WHERE request_version = <read>` and a row
 * is pending while `request_version > rendered_version`. requested_at / rendered_at are
 * kept for ordering and diagnostics only.
 *
 * Public pages are left to the build (MIG-0509): complete the tracker as
 * excluded_kind. Only unpublished / revoked / unrouted pages are deleted.
 *
 * Per message, bounded: D1 ≤ 3 statements (tracker, entity row LIMIT 1, CAS update),
 * 1 route shard read (2 for a video alias), 1 KV read, and at most 1 R2 DELETE.
 * Unrouted, revoked or non-public pages have their R2 HTML deleted.
 *
 * Ordering: the queue must be consumed with max_batch_size = 1 and max_concurrency = 1.
 * With one consumer at a time, a render that raced an unpublish loses its CAS and the
 * unpublish doorbell, processed next, deletes the HTML; meanwhile the gateway already
 * refuses the page through the revocation entry.
 */
import {
  isPublicVideoDirect,
  normalizePublicEventVisibility,
} from "../../../../src/lib/publicData/visibility.ts";
import { PUBLIC_LISTABLE_X_APPROVAL_STATUSES } from "../../../../src/lib/utils/publicXUser.ts";
import { r2HtmlKey, type RebuildRequest } from "./r2Html.ts";
import type { PageRenderEntityKind } from "./pageRenderRecovery.ts";
export { MAX_RECOVERY_DOORBELLS, recoverPendingPageRenders } from "./pageRenderRecovery.ts";
export type { PageRenderEntityKind, PageRenderQueueSender } from "./pageRenderRecovery.ts";
import { canonicalEntityId, revocationKey, routeKeyFromPath } from "./routeShards.ts";
import type { RouteLookup } from "./visibility.ts";

const MAX_PAGE_RENDERS_PER_INVOCATION = 1;

export interface PageRenderR2Bucket {
  delete: (key: string) => Promise<unknown>;
}

export interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  first: <T = unknown>(colName?: string) => Promise<T | null>;
  all: <T = unknown>() => Promise<{ results?: T[] }>;
  run: () => Promise<{ meta?: { changes?: number }; changes?: number }>;
}

export interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
}


export interface PageRenderEnv {
  DB?: D1DatabaseLike;
  R2_STORAGE?: PageRenderR2Bucket;
  VISIBILITY_KV?: { get: (key: string) => Promise<string | null> };
}

export type PageRenderDoorbell = Readonly<{ type: "render-page"; kind: PageRenderEntityKind; id: string }>;

export type PageRenderMessage =
  | Readonly<{ source: "gateway"; kind: PageRenderEntityKind; id: string; key: string }>
  | Readonly<{ source: "doorbell"; kind: PageRenderEntityKind; id: string; key: string }>;

export type PageRenderOutcome =
  | Readonly<{ action: "deleted"; kind: PageRenderEntityKind; id: string; key: string; reason: "not_routed" | "revoked" | "not_public" }>
  | Readonly<{ action: "excluded_kind"; kind: PageRenderEntityKind; id: string }>
  | Readonly<{ action: "skipped_up_to_date"; kind: PageRenderEntityKind; id: string }>
  | Readonly<{ action: "conflict_newer_request"; kind: PageRenderEntityKind; id: string }>
  | Readonly<{ action: "skipped_invalid_message" }>
  | Readonly<{ action: "retry"; reason: string }>;

const KINDS: ReadonlySet<string> = new Set(["video", "user", "event"]);

/** Route key the build gives an entity (routeMap.ts entityKey + gateway normalisation). */
export function canonicalRouteKey(kind: PageRenderEntityKind, id: string): string | null {
  if (typeof id !== "string" || id.length === 0 || id.length > 128 || id.includes("/") || id.includes("%")) {
    return null;
  }
  return routeKeyFromPath(kind === "video" ? `/${id}` : `/${kind}/${id}`);
}

export function parsePageRenderMessage(body: unknown): PageRenderMessage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.kind !== "string" || !KINDS.has(b.kind) || typeof b.id !== "string") return null;
  const kind = b.kind as PageRenderEntityKind;
  const key = canonicalRouteKey(kind, b.id);
  if (!key) return null;
  if (b.type === "rebuild-page") {
    // The gateway sends its decision key. It is this entity's canonical key, except a video
    // whose URL slug is its YouTube id (id = videos.id, key = slug): processPageRender then
    // checks the key against the route shard (kind and id must match).
    const request = b as Partial<RebuildRequest>;
    const sentKey = request.key;
    const valid = kind === "video"
      ? typeof sentKey === "string" && !sentKey.includes("/") && canonicalRouteKey("video", sentKey) === sentKey
      : sentKey === key;
    if (!valid || typeof sentKey !== "string") return null;
    return { source: "gateway", kind, id: b.id, key: sentKey };
  }
  // A video doorbell carries only videos.id; processPageRender follows the route alias to the slug key.
  if (b.type === "render-page") return { source: "doorbell", kind, id: b.id, key };
  return null;
}

type Tracker = { request_version: number; rendered_version: number };

const REQUEST_PAGE_RENDER_SQL = `INSERT INTO public_page_renders (entity, entity_id, requested_at, request_version)
  VALUES (?, ?, ?, 1)
  ON CONFLICT (entity, entity_id) DO UPDATE SET
    request_version = public_page_renders.request_version + 1,
    requested_at = excluded.requested_at`;

/**
 * Producer statement for the caller's D1 batch (same batch as the entity write). The id is
 * stored canonical (user ids lower-cased), as the consumer reads it.
 */
export function requestPageRenderStatement(
  db: D1DatabaseLike,
  kind: PageRenderEntityKind,
  id: string,
  now = Date.now(),
): D1PreparedStatementLike {
  return db.prepare(REQUEST_PAGE_RENDER_SQL).bind(kind, canonicalEntityId(kind, id), now);
}

const ENTITY_SQL: Record<PageRenderEntityKind, string> = {
  video: "SELECT id, visibility_status FROM videos WHERE id = ? LIMIT 1",
  // CURRENT normalises X ids case-insensitively.
  user: "SELECT id, approval_status FROM x_users WHERE lower(id) = ? LIMIT 1",
  event: "SELECT id, visibility_status FROM events WHERE id = ? LIMIT 1",
};

const LISTABLE_USER: ReadonlySet<string> = new Set(PUBLIC_LISTABLE_X_APPROVAL_STATUSES);

/** CURRENT's public rules (src/lib/publicData/visibility.ts, src/lib/utils/publicXUser.ts). Fail-closed. */
function isPublicRow(kind: PageRenderEntityKind, row: Record<string, unknown> | null): boolean {
  if (!row) return false;
  switch (kind) {
    case "video":
      return isPublicVideoDirect(row.visibility_status);
    case "event":
      return normalizePublicEventVisibility(row.visibility_status) === "public";
    case "user":
      return typeof row.approval_status === "string" && LISTABLE_USER.has(row.approval_status);
  }
}

function changesOf(result: { meta?: { changes?: number }; changes?: number }): number {
  return result.meta?.changes ?? result.changes ?? 0;
}

/**
 * Delete a page that is not positively public, or close the tracker for build-owned HTML.
 * Throws only for retryable binding/route/KV/D1/R2 failures.
 */
export async function processPageRender(
  message: PageRenderMessage,
  env: PageRenderEnv,
  lookup: RouteLookup,
  now = Date.now(),
): Promise<PageRenderOutcome> {
  const db = env.DB;
  const r2 = env.R2_STORAGE;
  const kv = env.VISIBILITY_KV;
  if (!db || !r2 || !kv) throw new Error("page render: DB, R2_STORAGE and VISIBILITY_KV are required");

  const { kind } = message;
  let key = message.key;
  const entityId = canonicalEntityId(kind, message.id);

  const tracker = await db
    .prepare(
      "SELECT request_version, rendered_version FROM public_page_renders WHERE entity = ? AND entity_id = ? LIMIT 1",
    )
    .bind(kind, entityId)
    .first<Tracker>();
  // A doorbell with nothing newer than the last render is a duplicate (T04). A gateway
  // request is not: the HTML can be missing or from an older build although rendered.
  if (message.source === "doorbell" && tracker && Number(tracker.request_version) <= Number(tracker.rendered_version)) {
    return { action: "skipped_up_to_date", kind, id: entityId };
  }

  const finish = async (outcome: PageRenderOutcome): Promise<PageRenderOutcome> => {
    if (!tracker) return outcome;
    const updated = await db
      .prepare(
        "UPDATE public_page_renders SET rendered_version = request_version, rendered_at = ? WHERE entity = ? AND entity_id = ? AND request_version = ?",
      )
      .bind(now, kind, entityId, tracker.request_version)
      .run();
    // A newer request arrived while this one ran (request_version moved on, even within the
    // same millisecond): leave rendered_version behind so its own doorbell (or recovery)
    // rebuilds the page (T03).
    return changesOf(updated) === 1 ? outcome : { action: "conflict_newer_request", kind, id: entityId };
  };
  const remove = async (reason: "not_routed" | "revoked" | "not_public") => {
    await r2.delete(r2HtmlKey(key));
    return finish({ action: "deleted", kind, id: entityId, key, reason });
  };

  let route = await lookup(key);
  if (!route) throw new Error("page render: route data unavailable");
  // Doorbell for a video whose slug is its YouTube id: the internal id is an alias of that key.
  if (message.source === "doorbell" && kind === "video" && route.resolution?.type === "redirect" && route.resolution.reason === "alias") {
    const slugKey = routeKeyFromPath(route.resolution.targetPath.split(/[?#]/, 1)[0]);
    if (slugKey) {
      key = slugKey;
      route = await lookup(key);
      if (!route) throw new Error("page render: route data unavailable");
    }
  }
  const resolution = route.resolution;
  if (
    !resolution ||
    resolution.type !== "canonical" ||
    resolution.kind !== kind ||
    canonicalEntityId(kind, resolution.id) !== entityId
  ) {
    // The gateway would answer 404 or redirect for this key; HTML there is never served.
    return remove("not_routed");
  }
  if ((await kv.get(revocationKey(kind, entityId))) !== null) return remove("revoked");

  const row = await db.prepare(ENTITY_SQL[kind]).bind(entityId).first<Record<string, unknown>>();
  if (!isPublicRow(kind, row)) return remove("not_public");
  // D-11: the build owns every Island HTML document; this consumer never PUTs.
  return finish({ action: "excluded_kind", kind, id: entityId });
}

export interface QueueMessage<T = unknown> {
  body: T;
  ack?: () => void;
  retry?: () => void;
}

export interface QueueBatch<T = unknown> {
  messages: readonly QueueMessage<T>[];
}

/**
 * Queue handler. Handles MAX_PAGE_RENDERS_PER_INVOCATION messages and retries the rest,
 * so one invocation stays within the per-message CPU budget even if the consumer is
 * misconfigured with a larger batch. Never throws: a failure retries that message only.
 */
export async function handlePageRenderQueue(
  batch: QueueBatch,
  env: PageRenderEnv,
  lookup: RouteLookup,
): Promise<PageRenderOutcome[]> {
  const outcomes: PageRenderOutcome[] = [];
  batch.messages.forEach((message, index) => {
    if (index >= MAX_PAGE_RENDERS_PER_INVOCATION) message.retry?.();
  });
  for (const message of batch.messages.slice(0, MAX_PAGE_RENDERS_PER_INVOCATION)) {
    const parsed = parsePageRenderMessage(message.body);
    if (!parsed) {
      outcomes.push({ action: "skipped_invalid_message" });
      message.ack?.();
      continue;
    }
    try {
      outcomes.push(await processPageRender(parsed, env, lookup));
      message.ack?.();
    } catch (error) {
      outcomes.push({ action: "retry", reason: error instanceof Error ? error.message : "error" });
      message.retry?.();
    }
  }
  return outcomes;
}

