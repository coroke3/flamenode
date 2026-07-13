import "server-only";

import { createPublicJsonLoader } from "./createPublicJsonLoader";
import {
  normalizeStaticEventDetail,
  type StaticEventDetail,
  type StaticEventDetailPayload,
} from "./staticEventDetailCore";

export const loadStaticEventDetail =
  createPublicJsonLoader<
    StaticEventDetailPayload,
    StaticEventDetail
  >({
    r2Key: (eventId) => `events/${eventId}.json`,
    targetType: "event",
    reason: "public_event_detail_miss",
    normalize: normalizeStaticEventDetail,
  });

export type {
  StaticEventDetail,
  StaticEventDetailVideo,
} from "./staticEventDetailCore";
