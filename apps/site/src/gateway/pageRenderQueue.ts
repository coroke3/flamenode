/**
 * Queue consumer: rebuild one public detail page per message into R2 (MIG-0411 /
 * R-JOB / Runtime B). Runs in the gateway Worker, so it reads the same route shards
 * (Static Assets) and writes exactly what `r2Html.ts` serves:
 *   key  = r2HtmlKey(<route key>)            e.g. `abc/index.html`, `user/x/index.html`
 *   meta = { generation: <route shard generation> }
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
 * Kinds whose PAGE_BODY_FORMAT is "excluded" (no page body this consumer can produce) are
 * never written: deletes for unpublished / revoked / unrouted pages still apply, a public
 * page is left to the build (MIG-0509) and the request is marked done.
 *
 * Per message, bounded: D1 ≤ 3 statements (tracker, entity row LIMIT 1, CAS update),
 * 1 route shard read, 1 KV read, 1 R2 PUT or DELETE. Nothing is written for a page that
 * is not positively public: not in the route shards, revoked (deny:<kind>:<id>), or not
 * public in D1 by CURRENT's rules — its R2 HTML is deleted instead.
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
import {
  PAGE_BODY_FORMAT,
  renderPublicPage,
  type PageRenderEntityKind,
  type PublicPageRow,
} from "./renderPublicPage.ts";
import { canonicalEntityId, revocationKey, routeKeyFromPath } from "./routeShards.ts";
import type { RouteLookup } from "./visibility.ts";

const MAX_PAGE_RENDERS_PER_INVOCATION = 1;
export const MAX_RECOVERY_DOORBELLS = 5;

export interface PageRenderR2Bucket {
  put: (
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ) => Promise<unknown>;
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

export type PageRenderQueueSender = { send: (message: PageRenderDoorbell) => Promise<unknown> };

export interface PageRenderEnv {
  DB?: D1DatabaseLike;
  R2_STORAGE?: PageRenderR2Bucket;
  VISIBILITY_KV?: { get: (key: string) => Promise<string | null> };
  /** Site origin for canonical / og:url, e.g. https://example.org. Required. */
  PUBLIC_SITE_URL?: string;
}

export type PageRenderDoorbell = Readonly<{ type: "render-page"; kind: PageRenderEntityKind; id: string }>;

export type PageRenderMessage =
  | Readonly<{ source: "gateway"; kind: PageRenderEntityKind; id: string; key: string }>
  | Readonly<{ source: "doorbell"; kind: PageRenderEntityKind; id: string; key: string }>;

export type PageRenderOutcome =
  | Readonly<{ action: "rendered"; kind: PageRenderEntityKind; id: string; key: string; generation: string }>
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
    // The gateway sends its decision key; it must be this entity's canonical key.
    const request = b as Partial<RebuildRequest>;
    if (request.key !== key) return null;
    return { source: "gateway", kind, id: b.id, key };
  }
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
  video: `SELECT id, title, creator_display_name, creator_x_user_id, creator_icon_url, creator_youtube_channel_url,
                 youtube_video_id, music, credit, music_reference_url, intro_comment, highlights,
                 production_story, closing_comment, visibility_status
          FROM videos WHERE id = ? LIMIT 1`,
  // x_users ids are compared lower-cased, as CURRENT fences and routes do (x_users_lower_id_idx).
  user: `SELECT id, x_name, icon_url, profile_text, portfolio_contact, youtube_channel_url, approval_status
         FROM x_users WHERE lower(id) = ? LIMIT 1`,
  event: `SELECT id, title, explanation, icon_url, img_url, visibility_status,
                 start_time, end_time, entry_start_time, entry_end_time
          FROM events WHERE id = ? LIMIT 1`,
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
 * Rebuild or delete one page. Throws only for conditions a retry can fix (missing
 * binding or configuration, route data / KV / D1 / R2 unavailable).
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
  const origin = env.PUBLIC_SITE_URL?.trim();
  if (!db || !r2 || !kv || !origin) throw new Error("page render: DB, R2_STORAGE, VISIBILITY_KV and PUBLIC_SITE_URL are required");

  const { kind, key } = message;
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

  const route = await lookup(key);
  if (!route) throw new Error("page render: route data unavailable");
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
  // No page body for this kind (no Island loader yet): never publish an empty shell.
  if (PAGE_BODY_FORMAT[kind] === "excluded") return finish({ action: "excluded_kind", kind, id: entityId });

  const html = await renderPublicPage(kind, row as PublicPageRow, {
    origin,
    canonicalPath: resolution.canonicalPath,
    nowSeconds: Math.floor(now / 1000),
  });
  await r2.put(r2HtmlKey(key), html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
    customMetadata: { generation: route.generation },
  });
  return finish({ action: "rendered", kind, id: entityId, key, generation: route.generation });
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

/**
 * U04 recovery: one bounded statement (partial index public_page_renders_pending_idx),
 * then one doorbell per pending row. NOT WIRED: the gateway has no Cron, and the
 * existing Cron Workers have no binding to this queue (adding one is a Cloudflare
 * configuration change that needs approval).
 */
export async function recoverPendingPageRenders(
  db: D1DatabaseLike,
  queue: PageRenderQueueSender,
  limit = MAX_RECOVERY_DOORBELLS,
): Promise<number> {
  const bounded = Math.min(Math.max(1, Math.floor(limit)), MAX_RECOVERY_DOORBELLS);
  const res = await db
    .prepare(
      "SELECT entity, entity_id FROM public_page_renders WHERE request_version > rendered_version ORDER BY requested_at ASC LIMIT ?",
    )
    .bind(bounded)
    .all<{ entity: PageRenderEntityKind; entity_id: string }>();
  const rows = res.results ?? [];
  for (const row of rows) {
    await queue.send({ type: "render-page", kind: row.entity, id: row.entity_id });
  }
  return rows.length;
}
