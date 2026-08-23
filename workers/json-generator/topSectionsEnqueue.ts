import {
  TOP_ANNOUNCEMENTS_OBJECT_KEY,
  TOP_EVENTS_OBJECT_KEY,
  TOP_LATEST_OBJECT_KEY,
  TOP_NOSTALGIC_OBJECT_KEY,
  TOP_RECOMMENDED_OBJECT_KEY,
  TOP_SECTION_OBJECT_KEYS,
  TOP_STATS_OBJECT_KEY,
} from "../../src/lib/publicData/staticTopSectionsCore.ts";

type EnqueueEnv = { DB: D1Database; R2: R2Bucket };

export const TOP_SECTION_TARGET_BY_OBJECT_KEY = {
  [TOP_RECOMMENDED_OBJECT_KEY]: "top_recommended",
  [TOP_LATEST_OBJECT_KEY]: "top_latest",
  [TOP_NOSTALGIC_OBJECT_KEY]: "top_nostalgic",
  [TOP_EVENTS_OBJECT_KEY]: "top_events",
  [TOP_ANNOUNCEMENTS_OBJECT_KEY]: "top_announcements",
  [TOP_STATS_OBJECT_KEY]: "top_stats",
} as const satisfies Record<
  (typeof TOP_SECTION_OBJECT_KEYS)[number],
  string
>;

/** 欠落数に関係なくJSON1 UPDATE+INSERTの2 statementsでenqueueする。 */
export const TOP_SECTIONS_REPAIR_MAX_D1_STATEMENTS = 2;

async function enqueueMissingTopSections(
  env: EnqueueEnv,
  targetTypes: readonly string[],
  reason: string,
  priority: "high" | "low",
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  if (targetTypes.length === 0) return 0;

  const now = Math.floor(Date.now() / 1000);
  const targetRows = targetTypes.map((targetType) => ({
    id: `srb:${targetType}:${crypto.randomUUID()}`,
    target_type: targetType,
  }));
  const targetJson = JSON.stringify(targetRows);

  const activeUpdate = env.DB.prepare(
    `UPDATE static_rebuild_queue
        SET reason = ?,
            priority = CASE
              WHEN priority = 'high' OR ? = 'high' THEN 'high'
              ELSE priority
            END,
            updated_at = MAX(updated_at + 1, ?)
      WHERE target_id = 'global'
        AND status IN ('pending', 'processing')
        AND target_type IN (
          SELECT CAST(json_extract(value, '$.target_type') AS TEXT)
          FROM json_each(?)
        )`,
  ).bind(reason, priority, now, targetJson);

  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO static_rebuild_queue (
       id, target_type, target_id, reason, priority, status,
       attempt_count, created_at, updated_at
     )
     SELECT
       CAST(json_extract(value, '$.id') AS TEXT),
       CAST(json_extract(value, '$.target_type') AS TEXT),
       'global', ?, ?, 'pending', 0, ?, ?
     FROM json_each(?)`,
  ).bind(reason, priority, now, now, targetJson);

  const results = await env.DB.batch([activeUpdate, insert]);
  signal?.throwIfAborted();
  return results.reduce(
    (sum, result) => sum + Math.max(0, Number(result.meta?.changes ?? 0)),
    0,
  );
}

/** R2上の top section artifact が欠けていれば該当 global target を enqueue する。 */
export async function ensureTopSectionsOnR2(
  env: EnqueueEnv,
  options: {
    reason: string;
    priority: "high" | "low";
    signal?: AbortSignal;
  },
): Promise<number> {
  options.signal?.throwIfAborted();

  const heads = await Promise.all(
    TOP_SECTION_OBJECT_KEYS.map((objectKey) => env.R2.head(objectKey)),
  );

  const missingTargets: string[] = [];
  for (let index = 0; index < TOP_SECTION_OBJECT_KEYS.length; index += 1) {
    options.signal?.throwIfAborted();
    if (heads[index]) continue;
    const objectKey = TOP_SECTION_OBJECT_KEYS[index];
    missingTargets.push(TOP_SECTION_TARGET_BY_OBJECT_KEY[objectKey]);
  }

  // 旧実装は欠落artifactごとにUPDATE+INSERTし、6欠落で12 D1 statementsを消費した。
  // JSON1へまとめてD1 Freeの50 queries/invocationとCron CPUの両方を節約する。
  return enqueueMissingTopSections(
    env,
    missingTargets,
    options.reason,
    options.priority,
    options.signal,
  );
}
