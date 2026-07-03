import "server-only";
import { loadPublicJson } from "./loader";
import {
  normalizeStaticEventsIndex,
  type StaticEventsIndex,
  type StaticEventsIndexPayload,
} from "./staticEventsIndexCore";

const EVENTS_INDEX_KEY = "events/index.json";

export async function loadStaticEventsIndex(): Promise<{
  index: StaticEventsIndex | null;
  strategy: Awaited<ReturnType<typeof loadPublicJson>>["strategy"];
  enqueued: boolean;
}> {
  const result = await loadPublicJson<StaticEventsIndexPayload>({
    r2Key: EVENTS_INDEX_KEY,
    targetType: "events_index",
    targetId: "global",
    reason: "public_events_index_miss",
  });
  return {
    index: result.data ? normalizeStaticEventsIndex(result.data) : null,
    strategy: result.strategy,
    enqueued: result.enqueued,
  };
}
