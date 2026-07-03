import "server-only";
import { loadPublicJson } from "./loader";
import {
  normalizeStaticEventDetail,
  type StaticEventDetail,
  type StaticEventDetailPayload,
} from "./staticEventDetailCore";

export async function loadStaticEventDetail(eventId: string): Promise<{
  detail: StaticEventDetail | null;
  strategy: Awaited<ReturnType<typeof loadPublicJson>>["strategy"];
  enqueued: boolean;
}> {
  const result = await loadPublicJson<StaticEventDetailPayload>({
    r2Key: `events/${eventId}.json`,
    targetType: "event",
    targetId: eventId,
    reason: "public_event_detail_miss",
  });
  return {
    detail: result.data ? normalizeStaticEventDetail(result.data) : null,
    strategy: result.strategy,
    enqueued: result.enqueued,
  };
}

export type { StaticEventDetail, StaticEventDetailVideo } from "./staticEventDetailCore";
