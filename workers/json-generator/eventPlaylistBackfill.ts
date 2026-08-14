type BackfillEnv = {
  DB: D1Database;
  KV: KVNamespace;
};

export const EVENT_PLAYLIST_BACKFILL_CURSOR_KEY =
  "static:event-playlist-projection-repair:v1:cursor";
export const EVENT_PLAYLIST_BACKFILL_DONE_KEY =
  "static:event-playlist-projection-repair:v1:done";
export const EVENT_PLAYLIST_BACKFILL_BATCH_SIZE = 10;
/** 1 cursor SELECT + 2 queue statements per event。Recovery soft limit内で開始可否を判定する。 */
export const EVENT_PLAYLIST_BACKFILL_MAX_STATEMENTS =
  1 + EVENT_PLAYLIST_BACKFILL_BATCH_SIZE * 2;

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(
    signal.reason === undefined
      ? "event playlist projection repair aborted"
      : String(signal.reason),
  );
}

function enqueueEventBaseStatement(
  env: BackfillEnv,
  eventId: string,
  now: number,
): D1PreparedStatement[] {
  const reason = "event_playlist_backfill";
  const activeUpdate = env.DB.prepare(
    `UPDATE static_rebuild_queue
        SET reason = CASE
              WHEN priority = 'high' THEN reason
              ELSE ?
            END,
            priority = CASE
              WHEN priority = 'high' THEN 'high'
              ELSE 'normal'
            END,
            updated_at = MAX(updated_at + 1, ?)
      WHERE target_type = 'event_base'
        AND target_id = ?
        AND status IN ('pending', 'processing')`,
  ).bind(reason, now, eventId);

  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO static_rebuild_queue (
       id, target_type, target_id, reason, priority, status,
       attempt_count, created_at, updated_at
     ) VALUES (?, 'event_base', ?, ?, 'normal', 'pending', 0, ?, ?)`,
  ).bind(
    `srb:event-playlist-projection-repair:${eventId}:${crypto.randomUUID()}`,
    eventId,
    reason,
    now,
    now,
  );
  return [activeUpdate, insert];
}

/**
 * 既存 public event の event_base を一度だけ bounded enqueue する。
 * playlist 専用 target は作らず、通常の event_base rebuild に projection 生成を委譲する。
 */
export async function ensureEventPlaylistBackfill(
  env: BackfillEnv,
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal);
  if ((await env.KV.get(EVENT_PLAYLIST_BACKFILL_DONE_KEY)) === "1") return 0;

  const cursor = (await env.KV.get(EVENT_PLAYLIST_BACKFILL_CURSOR_KEY))?.trim() ?? "";
  throwIfAborted(signal);
  const result = await env.DB.prepare(
    `SELECT id
       FROM events
      WHERE visibility_status = 'public'
        AND id > ?
      ORDER BY id ASC
      LIMIT ?`,
  )
    .bind(cursor, EVENT_PLAYLIST_BACKFILL_BATCH_SIZE)
    .all<{ id: string }>();
  throwIfAborted(signal);

  const eventIds = (result.results ?? [])
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);
  if (eventIds.length === 0) {
    await env.KV.put(EVENT_PLAYLIST_BACKFILL_DONE_KEY, "1");
    return 0;
  }

  const now = Math.floor(Date.now() / 1000);
  const statements = eventIds.flatMap((eventId) =>
    enqueueEventBaseStatement(env, eventId, now),
  );
  await env.DB.batch(statements);
  throwIfAborted(signal);

  const nextCursor = eventIds.at(-1);
  if (nextCursor) {
    await env.KV.put(EVENT_PLAYLIST_BACKFILL_CURSOR_KEY, nextCursor);
  }
  if (eventIds.length < EVENT_PLAYLIST_BACKFILL_BATCH_SIZE) {
    await env.KV.put(EVENT_PLAYLIST_BACKFILL_DONE_KEY, "1");
  }
  return eventIds.length;
}
