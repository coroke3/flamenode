import "server-only";
import { readStaticJsonIfStaticOnly } from "./staticJson";
import {
  normalizeStaticEventsIndex,
  type StaticEventsIndex,
  type StaticEventsIndexPayload,
} from "./staticEventsIndexCore";

const EVENTS_INDEX_KEY = "events/index.json";

export async function loadStaticEventsIndex(): Promise<StaticEventsIndex | null> {
  const payload =
    await readStaticJsonIfStaticOnly<StaticEventsIndexPayload>(EVENTS_INDEX_KEY);
  if (!payload) return null;
  return normalizeStaticEventsIndex(payload);
}
