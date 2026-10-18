/**
 * Queue consumer for queue-driven ISR page regeneration (MIG-0411 / Recipe R-JOB / Runtime B).
 * Processes one page per message (max_batch_size = 1), bounded CPU (< 8ms), fail-closed CAS updates.
 * Work truth is in D1 (public_page_renders), Queue is a doorbell (ZERO_1102.md).
 */
import {
  renderPublicPage,
  type PageRenderEntityKind,
  type PublicPageRow,
} from "./renderPublicPage.ts";

export interface PageRenderR2Bucket {
  put: (
    key: string,
    value: string | ReadableStream | ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ) => Promise<unknown>;
  delete: (key: string | string[]) => Promise<unknown>;
}

export interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  first: <T = unknown>(colName?: string) => Promise<T | null>;
  all: <T = unknown>() => Promise<{ results?: T[]; success?: boolean; meta?: { changes?: number } }>;
  run: () => Promise<{ success?: boolean; meta?: { changes?: number }; changes?: number }>;
}

export interface D1DatabaseLike {
  prepare: (query: string) => D1PreparedStatementLike;
}

export interface PageRenderEnv {
  DB?: D1DatabaseLike;
  D1?: D1DatabaseLike;
  R2_STORAGE?: PageRenderR2Bucket;
  PAGE_RENDER_QUEUE?: { send: (msg: unknown) => Promise<unknown> };
  REBUILD_QUEUE?: { send: (msg: unknown) => Promise<unknown> };
  DEFAULT_GENERATION?: string;
}

export type PageRenderOutcome =
  | { action: "rendered"; entity: PageRenderEntityKind; id: string; key: string }
  | { action: "deleted"; entity: PageRenderEntityKind; id: string; key: string }
  | { action: "skipped_up_to_date"; entity: PageRenderEntityKind; id: string }
  | { action: "skipped_invalid_message"; raw: unknown }
  | { action: "conflict_retry_pending"; entity: PageRenderEntityKind; id: string };

/** Primary key read by the gateway's loadR2PrebuiltHtml (r2HtmlKey). */
export function pageRenderGatewayKey(entity: PageRenderEntityKind, id: string): string {
  switch (entity) {
    case "video":
      return `${id}/index.html`;
    case "user":
      return `user/${id}/index.html`;
    case "event":
      return `event/${id}/index.html`;
  }
}

/** Spec-compatible path pages/<entity>/<id>.html mentioned in PHASE_4_5_SPEC.md. */
export function pageRenderSpecKey(entity: PageRenderEntityKind, id: string): string {
  return `pages/${entity}/${id}.html`;
}

export function parsePageRenderMessage(
  body: unknown,
): { entity: PageRenderEntityKind; id: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  const rawEntity = b.entity ?? b.kind;
  const rawId = b.entity_id ?? b.id;

  if (
    (rawEntity === "video" || rawEntity === "user" || rawEntity === "event") &&
    typeof rawId === "string" &&
    rawId.length > 0
  ) {
    return { entity: rawEntity as PageRenderEntityKind, id: rawId };
  }
  return null;
}

interface RenderTrackerRow {
  requested_at: number;
  rendered_at: number;
}

/**
 * Process a single page regeneration request with CAS atomicity.
 * 1. Checks public_page_renders: if requested_at <= rendered_at, no-op (T04).
 * 2. Fetches row from D1: checks visibility (public vs private/deleted).
 * 3. If public: renders HTML shell, puts to R2 (T01).
 * 4. If private/deleted: deletes HTML from R2 (T02).
 * 5. Conditional UPDATE on public_page_renders (WHERE requested_at = ?):
 *    if modified concurrently, rendered_at is NOT advanced so next message re-renders (T03).
 */
export async function processPageRenderItem(
  entity: PageRenderEntityKind,
  id: string,
  env: PageRenderEnv,
  now = Date.now(),
): Promise<PageRenderOutcome> {
  const db = env.DB ?? env.D1;
  const r2 = env.R2_STORAGE;

  if (!db || !r2) {
    throw new Error("[processPageRenderItem] Missing DB or R2_STORAGE binding");
  }

  const gatewayKey = pageRenderGatewayKey(entity, id);
  const specKey = pageRenderSpecKey(entity, id);
  const generation = env.DEFAULT_GENERATION ?? "isr-v1";

  // Step 1: Query requested_at and rendered_at
  const tracker = await db
    .prepare("SELECT requested_at, rendered_at FROM public_page_renders WHERE entity = ? AND entity_id = ?")
    .bind(entity, id)
    .first<RenderTrackerRow>();

  if (tracker && tracker.requested_at <= tracker.rendered_at) {
    return { action: "skipped_up_to_date", entity, id };
  }

  const expectedReqAt = tracker ? tracker.requested_at : now;

  // Step 2: Query entity and determine visibility
  let row: PublicPageRow | null = null;
  let isPublic = false;

  if (entity === "video") {
    const video = await db
      .prepare("SELECT id, title, description, creator_name, thumbnail_url, visibility FROM videos WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (video && video.visibility === "public") {
      row = video;
      isPublic = true;
    }
  } else if (entity === "user") {
    const user = await db
      .prepare("SELECT id, name, handle, bio, icon_url FROM x_users WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (user) {
      row = user;
      isPublic = true;
    }
  } else if (entity === "event") {
    const event = await db
      .prepare("SELECT id, title, description, icon_url, visibility FROM events WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (event && (event.visibility === "public" || event.visibility === undefined || event.visibility === null)) {
      row = event;
      isPublic = true;
    }
  }

  // Step 3: Put or Delete R2 HTML
  if (isPublic && row) {
    const html = renderPublicPage(entity, row, { generation });
    await r2.put(gatewayKey, html, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { generation },
    });
    await r2.put(specKey, html, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { generation },
    });
  } else {
    await r2.delete(gatewayKey);
    await r2.delete(specKey);
  }

  // Step 4: Conditional CAS update to record rendered_at
  const updateRes = await db
    .prepare(
      "UPDATE public_page_renders SET rendered_at = ? WHERE entity = ? AND entity_id = ? AND requested_at = ?",
    )
    .bind(now, entity, id, expectedReqAt)
    .run();

  const changes = updateRes.meta?.changes ?? updateRes.changes ?? 0;
  if (tracker && changes === 0) {
    // A newer update arrived between step 1 and step 4; do not advance rendered_at
    return { action: "conflict_retry_pending", entity, id };
  }

  return {
    action: isPublic ? "rendered" : "deleted",
    entity,
    id,
    key: gatewayKey,
  };
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
 * Queue handler entrypoint for Cloudflare Workers.
 * Processes each message in the batch (configured with max_batch_size = 1 in production).
 */
export async function handlePageRenderQueue(
  batch: QueueBatch,
  env: PageRenderEnv,
): Promise<PageRenderOutcome[]> {
  const outcomes: PageRenderOutcome[] = [];

  for (const message of batch.messages) {
    const parsed = parsePageRenderMessage(message.body);
    if (!parsed) {
      outcomes.push({ action: "skipped_invalid_message", raw: message.body });
      if (typeof message.ack === "function") message.ack();
      continue;
    }

    try {
      const outcome = await processPageRenderItem(parsed.entity, parsed.id, env);
      outcomes.push(outcome);
      if (typeof message.ack === "function") message.ack();
    } catch (error) {
      if (typeof message.retry === "function") {
        message.retry();
      }
      throw error;
    }
  }

  return outcomes;
}

/**
 * U04 recovery: inspects pending page renders where requested_at > rendered_at
 * and enqueues doorbell messages for any unprocessed items. Bounded (limit).
 */
export async function recoverPendingPageRenders(
  db: D1DatabaseLike,
  queue: { send: (msg: unknown) => Promise<unknown> },
  limit = 5,
): Promise<number> {
  const res = await db
    .prepare(
      "SELECT entity, entity_id FROM public_page_renders WHERE requested_at > rendered_at ORDER BY requested_at ASC LIMIT ?",
    )
    .bind(limit)
    .all<{ entity: PageRenderEntityKind; entity_id: string }>();

  const rows = res.results ?? [];
  for (const row of rows) {
    await queue.send({ entity: row.entity, entity_id: row.entity_id });
  }
  return rows.length;
}
