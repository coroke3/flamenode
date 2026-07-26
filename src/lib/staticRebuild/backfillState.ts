import "server-only";

import { getEnv } from "@/lib/cloudflare";
import {
  createEmptyStaticBackfillState,
  parseStaticBackfillState,
  STATIC_BACKFILL_KV_KEY,
  type StaticBackfillState,
} from "./backfillStateCore";

function getBackfillKv(): KVNamespace | null {
  try {
    return getEnv().KV ?? null;
  } catch {
    return null;
  }
}

export async function readStaticBackfillState(): Promise<StaticBackfillState> {
  const kv = getBackfillKv();
  if (!kv) {
    return createEmptyStaticBackfillState();
  }

  try {
    const raw = await kv.get(STATIC_BACKFILL_KV_KEY);
    if (!raw) {
      return createEmptyStaticBackfillState();
    }

    return parseStaticBackfillState(JSON.parse(raw));
  } catch {
    return createEmptyStaticBackfillState();
  }
}

export async function writeStaticBackfillState(
  state: StaticBackfillState,
): Promise<boolean> {
  const kv = getBackfillKv();
  if (!kv) return false;

  try {
    await kv.put(STATIC_BACKFILL_KV_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
