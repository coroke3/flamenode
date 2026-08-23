import { normalizeStaticEventsIndex } from "../../src/lib/publicData/staticEventsIndexCore.ts";
import { PUBLIC_JSON_CACHE_TTL_SEC } from "../../src/lib/publicData/publicJsonCacheTtl.ts";
import {
  computeEventStatus,
  type EventStatusInput,
} from "../../src/lib/utils/eventStatusCore.ts";

export const RANKING_LAST_SCORE_REBUILD_KV_KEY = "ranking:last-score-rebuild";
export const SCORE_REBUILD_ACTIVE_INTERVAL_SEC = 3600;
export const SCORE_REBUILD_INACTIVE_INTERVAL_SEC = 10800;
export const EVENTS_INDEX_R2_KEY = "events/index.json";
export const EVENTS_INDEX_STALE_MAX_AGE_SEC =
  PUBLIC_JSON_CACHE_TTL_SEC.eventsIndex * 2;
/** processing の in-flight 判定は lease_expires_at > now（queue.ts PROCESSING_LEASE_SEC = 5分 と整合）。 */
const SCORE_REBUILD_TARGETS = ["top_recommended", "list_popular", "recommend_core"] as const;
type ScoreRebuildTarget = (typeof SCORE_REBUILD_TARGETS)[number];
/** R2失敗時events D1 fallback 1 + users_index in-flight 1 + JSON1 enqueue 1。 */
export const SCORE_RANKING_REBUILD_MAX_D1_STATEMENTS = 3;

export type ScoreRebuildEnqueueEnv = {
  DB: D1Database;
  R2: R2Bucket;
  KV: KVNamespace;
};

export type ScoreRebuildEnqueueResult = {
  processed: number;
  failed: number;
  skipped: number;
  external_api_calls: number;
  d1_changes: number;
  retry_count: number;
  quota_stopped: boolean;
};

export type ActiveOngoingEventSource = "r2" | "d1_fallback" | "safe_default";

export type ActiveOngoingEventResolution = {
  hasActiveOngoingEvent: boolean;
  source: ActiveOngoingEventSource;
};

type D1EventStatusRow = {
  visibility_status?: string | null;
  start_time?: number | null;
  end_time?: number | null;
  entry_start_time?: number | null;
  entry_end_time?: number | null;
};

export function scoreRebuildThrottleIntervalSec(
  hasActiveOngoingEvent: boolean,
): number {
  return hasActiveOngoingEvent
    ? SCORE_REBUILD_ACTIVE_INTERVAL_SEC
    : SCORE_REBUILD_INACTIVE_INTERVAL_SEC;
}

export function shouldSkipScoreRebuildEnqueue(
  lastEnqueueUnix: number | null,
  nowUnix: number,
  intervalSec: number,
): boolean {
  if (lastEnqueueUnix == null) return false;
  return nowUnix - lastEnqueueUnix < intervalSec;
}

export function hasActiveOngoingEventStatus(
  event: EventStatusInput,
  nowUnix: number,
): boolean {
  return computeEventStatus(event, nowUnix) === "active";
}

export function indexHasActiveOngoingEvent(
  events: readonly EventStatusInput[],
  nowUnix: number,
): boolean {
  return events.some((event) => hasActiveOngoingEventStatus(event, nowUnix));
}

function parseLastScoreRebuildMarker(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export async function readLastScoreRebuildMarker(
  kv: KVNamespace,
): Promise<number | null> {
  const raw = await kv.get(RANKING_LAST_SCORE_REBUILD_KV_KEY);
  return parseLastScoreRebuildMarker(raw);
}

export async function writeLastScoreRebuildMarker(
  kv: KVNamespace,
  nowUnix: number,
): Promise<void> {
  await kv.put(RANKING_LAST_SCORE_REBUILD_KV_KEY, String(nowUnix));
}

export function isEventsIndexPayloadStale(
  generatedAt: number | null,
  nowUnix: number,
  maxAgeSec: number = EVENTS_INDEX_STALE_MAX_AGE_SEC,
): boolean {
  if (generatedAt == null) return true;
  return nowUnix - generatedAt > maxAgeSec;
}

function parseEventsIndexGeneratedAt(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const parsed = Number((payload as { generated_at?: unknown }).generated_at);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function collectEventsFromIndex(
  payload: unknown,
): EventStatusInput[] | null {
  const normalized = normalizeStaticEventsIndex(
    payload && typeof payload === "object"
      ? (payload as { generated_at?: unknown; items?: unknown; group_sections?: unknown })
      : {},
  );
  if (!normalized) return null;
  const rows: EventStatusInput[] = [...normalized.events];
  for (const section of normalized.groupSections) {
    rows.push(...section.events);
  }
  return rows;
}

async function resolveHasActiveOngoingEventFromR2(
  env: Pick<ScoreRebuildEnqueueEnv, "R2">,
  nowUnix: number,
  signal?: AbortSignal,
): Promise<ActiveOngoingEventResolution | null> {
  signal?.throwIfAborted();
  try {
    const object = await env.R2.get(EVENTS_INDEX_R2_KEY);
    signal?.throwIfAborted();
    if (!object) return null;
    const payload = await object.json();
    signal?.throwIfAborted();
    if (isEventsIndexPayloadStale(parseEventsIndexGeneratedAt(payload), nowUnix)) {
      return null;
    }
    const events = collectEventsFromIndex(payload);
    if (!events) return null;
    return {
      hasActiveOngoingEvent: indexHasActiveOngoingEvent(events, nowUnix),
      source: "r2",
    };
  } catch {
    return null;
  }
}

async function resolveHasActiveOngoingEventFromD1(
  env: Pick<ScoreRebuildEnqueueEnv, "DB">,
  nowUnix: number,
  signal?: AbortSignal,
): Promise<ActiveOngoingEventResolution | null> {
  signal?.throwIfAborted();
  try {
    const row = await env.DB.prepare(
      `SELECT visibility_status, start_time, end_time, entry_start_time, entry_end_time
         FROM events
        WHERE visibility_status = 'public'
          AND NOT (
                (start_time IS NOT NULL AND end_time IS NULL)
             OR (start_time IS NULL AND end_time IS NOT NULL)
              )
          AND (start_time IS NOT NULL OR end_time IS NOT NULL)
          AND (end_time IS NULL OR end_time > ?)
          AND (start_time IS NULL OR start_time <= ?)
        LIMIT 1`,
    )
      .bind(nowUnix, nowUnix)
      .first<D1EventStatusRow>();
    signal?.throwIfAborted();
    return {
      hasActiveOngoingEvent:
        row != null && hasActiveOngoingEventStatus(row, nowUnix),
      source: "d1_fallback",
    };
  } catch {
    return null;
  }
}

export async function resolveHasActiveOngoingEvent(
  env: Pick<ScoreRebuildEnqueueEnv, "R2" | "DB">,
  nowUnix: number,
  signal?: AbortSignal,
): Promise<ActiveOngoingEventResolution> {
  const fromR2 = await resolveHasActiveOngoingEventFromR2(env, nowUnix, signal);
  if (fromR2) return fromR2;
  const fromD1 = await resolveHasActiveOngoingEventFromD1(env, nowUnix, signal);
  if (fromD1) return fromD1;
  return {
    hasActiveOngoingEvent: true,
    source: "safe_default",
  };
}

export async function shouldThrottleScoreDependentRebuild(
  env: ScoreRebuildEnqueueEnv,
  nowUnix: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const lastMarker = await readLastScoreRebuildMarker(env.KV);
  if (lastMarker == null) return false;

  const resolution = await resolveHasActiveOngoingEvent(env, nowUnix, signal);
  if (resolution.source === "safe_default") return false;

  const intervalSec = scoreRebuildThrottleIntervalSec(
    resolution.hasActiveOngoingEvent,
  );
  return shouldSkipScoreRebuildEnqueue(lastMarker, nowUnix, intervalSec);
}

async function isUsersIndexRebuildInFlight(
  env: Pick<ScoreRebuildEnqueueEnv, "DB">,
  nowUnix: number,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS active
         FROM static_rebuild_queue
        WHERE target_type = 'users_index'
          AND target_id = 'global'
          AND (
                status = 'pending'
             OR (
                  status = 'processing'
              AND (lease_expires_at IS NULL OR lease_expires_at > ?)
                )
              )
        LIMIT 1`,
    )
      .bind(nowUnix)
      .first<{ active?: number }>();
    signal?.throwIfAborted();
    return row?.active === 1;
  } catch {
    return false;
  }
}

function resolveScoreRebuildTargets(
  _usersIndexInFlight: boolean,
): readonly ScoreRebuildTarget[] {
  return SCORE_REBUILD_TARGETS;
}

export async function enqueueScoreDependentRebuilds(
  env: ScoreRebuildEnqueueEnv,
  signal?: AbortSignal,
): Promise<ScoreRebuildEnqueueResult> {
  signal?.throwIfAborted();
  const now = Math.floor(Date.now() / 1000);

  if (await shouldThrottleScoreDependentRebuild(env, now, signal)) {
    return {
      processed: 0,
      failed: 0,
      skipped: 1,
      external_api_calls: 0,
      d1_changes: 0,
      retry_count: 0,
      quota_stopped: false,
    };
  }

  const usersIndexInFlight = await isUsersIndexRebuildInFlight(env, now, signal);
  const targets = resolveScoreRebuildTargets(usersIndexInFlight);
  if (targets.length === 0) {
    return {
      processed: 0,
      failed: 0,
      skipped: 1,
      external_api_calls: 0,
      d1_changes: 0,
      retry_count: 0,
      quota_stopped: false,
    };
  }

  // 固定3 targetを1 INSERT/SELECTへまとめる。旧実装は3 prepared statementsを
  // batchしていたため、YouTube同期後のD1 invocation budgetを余計に消費していた。
  const targetRows = targets.map((targetType) => ({
    id: `srb:${targetType}:${crypto.randomUUID()}`,
    target_type: targetType,
  }));
  const targetJson = JSON.stringify(targetRows);
  const insert = env.DB.prepare(
    `INSERT OR IGNORE INTO static_rebuild_queue (
       id, target_type, target_id, reason, priority, status,
       attempt_count, created_at, updated_at
     )
     SELECT
       CAST(json_extract(value, '$.id') AS TEXT),
       CAST(json_extract(value, '$.target_type') AS TEXT),
       'global', 'score_recalc', 'high', 'pending', 0, ?, ?
     FROM json_each(?)`,
  ).bind(now, now, targetJson);
  const result = await insert.run();
  signal?.throwIfAborted();
  const processed = Math.max(0, Number(result.meta?.changes ?? 0));

  if (processed > 0 && !usersIndexInFlight) {
    await writeLastScoreRebuildMarker(env.KV, now);
  }

  return processed > 0
    ? {
        processed,
        failed: 0,
        skipped: 0,
        external_api_calls: 0,
        d1_changes: processed,
        retry_count: 0,
        quota_stopped: false,
      }
    : {
        processed: 0,
        failed: 0,
        skipped: 1,
        external_api_calls: 0,
        d1_changes: 0,
        retry_count: 0,
        quota_stopped: false,
      };
}
