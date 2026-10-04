import {
  TOP_ANNOUNCEMENTS_OBJECT_KEY,
  TOP_EVENTS_OBJECT_KEY,
  TOP_LATEST_OBJECT_KEY,
  TOP_NOSTALGIC_OBJECT_KEY,
  TOP_RECOMMENDED_OBJECT_KEY,
  TOP_SECTION_OBJECT_KEYS,
  TOP_STATS_OBJECT_KEY,
} from "../../src/lib/publicData/staticTopSectionsCore.ts";
import { enqueueStaticRebuildTargets, globalTargets } from "./staticRebuildEnqueue.ts";

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

/** 欠落数に関係なく JSON1 upsert 1 statement で enqueue する。 */
export const TOP_SECTIONS_REPAIR_MAX_D1_STATEMENTS = 1;

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

  // 欠落数に関係なく 1 statement。D1 Free の 50 queries/invocation を節約する。
  return enqueueStaticRebuildTargets(
    env,
    globalTargets(missingTargets),
    options.reason,
    options.priority,
    options.signal,
  );
}
