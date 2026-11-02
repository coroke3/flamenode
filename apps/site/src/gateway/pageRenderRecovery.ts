/**
 * Bounded page tracker recovery for the hourly fast-jobs Cron (MIG-0411).
 * Intentionally free of gateway/Astro imports: the Cron only needs D1 and a Queue sender.
 */
export type PageRenderEntityKind = "video" | "user" | "event";
export type PageRenderDoorbell = Readonly<{ type: "render-page"; kind: PageRenderEntityKind; id: string }>;
export type PageRenderQueueSender = { send: (message: PageRenderDoorbell) => Promise<unknown> };
export const MAX_RECOVERY_DOORBELLS = 5;

export interface PendingPageRenderDb {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => {
      all: <T = unknown>() => Promise<{ results?: T[] }>;
    };
  };
}

/** One indexed D1 SELECT and no more than five doorbells per Cron invocation. */
export async function recoverPendingPageRenders(
  db: PendingPageRenderDb,
  queue: PageRenderQueueSender,
  limit = MAX_RECOVERY_DOORBELLS,
): Promise<number> {
  const bounded = Math.min(Math.max(1, Math.floor(limit)), MAX_RECOVERY_DOORBELLS);
  const result = await db
    .prepare(
      "SELECT entity, entity_id FROM public_page_renders WHERE request_version > rendered_version ORDER BY requested_at ASC LIMIT ?",
    )
    .bind(bounded)
    .all<{ entity: PageRenderEntityKind; entity_id: string }>();
  const rows = result.results ?? [];
  for (const row of rows) {
    await queue.send({ type: "render-page", kind: row.entity, id: row.entity_id });
  }
  return rows.length;
}
