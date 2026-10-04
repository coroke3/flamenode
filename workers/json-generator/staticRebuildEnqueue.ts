export type StaticRebuildEnqueuePriority = "high" | "normal" | "low";
export type StaticRebuildEnqueueTarget = { targetType: string; targetId: string };

/**
 * Active（pending/processing）行があれば reason・priority（高い方）・updated_at を更新し、
 * なければ pending で INSERT する。partial unique index を ON CONFLICT の対象にした
 * 1 statement なので、対象ごとに index lookup 1 回で済む。旧実装の
 * `UPDATE ... WHERE status IN (...) AND target IN json_each` + `INSERT OR IGNORE` の
 * 2 statements は active backlog 全件を走査していた。changes は対象 1 件につき 1。
 */
const STATIC_REBUILD_ENQUEUE_SQL = `
  INSERT INTO static_rebuild_queue (
    id, target_type, target_id, reason, priority, status,
    attempt_count, created_at, updated_at
  )
  SELECT
    CAST(json_extract(value, '$.id') AS TEXT),
    CAST(json_extract(value, '$.target_type') AS TEXT),
    CAST(json_extract(value, '$.target_id') AS TEXT),
    ?1, ?2, 'pending', 0, ?3, ?3
  FROM json_each(?4)
  WHERE 1 = 1
  ON CONFLICT(target_type, target_id) WHERE status IN ('pending', 'processing')
  DO UPDATE SET
    reason = excluded.reason,
    priority = CASE
      WHEN static_rebuild_queue.priority = 'high' OR excluded.priority = 'high' THEN 'high'
      WHEN static_rebuild_queue.priority = 'normal' OR excluded.priority = 'normal' THEN 'normal'
      ELSE static_rebuild_queue.priority
    END,
    updated_at = MAX(static_rebuild_queue.updated_at + 1, excluded.updated_at)
`;

/** 他の statement と同じ batch に入れるための builder。対象 0 件なら null。 */
export function prepareStaticRebuildEnqueue(
  db: D1Database,
  targets: readonly StaticRebuildEnqueueTarget[],
  reason: string,
  priority: StaticRebuildEnqueuePriority,
): D1PreparedStatement | null {
  if (targets.length === 0) return null;
  const rows = targets.map(({ targetType, targetId }) => ({
    id: `srb:${targetType}:${crypto.randomUUID()}`,
    target_type: targetType,
    target_id: targetId,
  }));
  return db
    .prepare(STATIC_REBUILD_ENQUEUE_SQL)
    .bind(reason, priority, Math.floor(Date.now() / 1000), JSON.stringify(rows));
}

export function d1Changes(result: D1Result | undefined): number {
  return Math.max(0, Number(result?.meta?.changes ?? 0));
}

/** 1 D1 statement で static rebuild target を冪等 enqueue し、変更行数を返す。 */
export async function enqueueStaticRebuildTargets(
  env: { DB: D1Database },
  targets: readonly StaticRebuildEnqueueTarget[],
  reason: string,
  priority: StaticRebuildEnqueuePriority,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const statement = prepareStaticRebuildEnqueue(env.DB, targets, reason, priority);
  if (!statement) return 0;
  const result = await statement.run();
  signal?.throwIfAborted();
  return d1Changes(result);
}

/** target_id = 'global' の target 群。 */
export function globalTargets(
  targetTypes: readonly string[],
): StaticRebuildEnqueueTarget[] {
  return targetTypes.map((targetType) => ({ targetType, targetId: "global" }));
}
