/**
 * Build-time public event data (MIG-0502 / Recipe R-PAGE / Runtime S0).
 * Reads CURRENT's three event JSON shapes from the verified snapshot directory, or from the fixtures when
 * no directory is configured, and normalizes them with CURRENT's own `staticEvent*Core` functions.
 * No request-time reads: pages are rendered once per build from this object.
 *
 * Env (same as `/about` stats): FLAMENODE_SNAPSHOT_DIR, FLAMENODE_SNAPSHOT_MANIFEST_FILE, FLAMENODE_SNAPSHOT_GENERATION.
 * A missing/invalid manifest fails the build. One object that fails verification or normalizes to nothing
 * (private, unknown schema) produces no page; the id is logged. An unreadable index renders CURRENT's
 * "一時的に表示できません" state instead of an empty list.
 */
import { normalizeStaticEventsIndex, type StaticEventsIndex } from "../../../../src/lib/publicData/staticEventsIndexCore.ts";
import { normalizeStaticEventDetail, type StaticEventDetail } from "../../../../src/lib/publicData/staticEventDetailCore.ts";
import { normalizeStaticEventRelease, type StaticEventRelease } from "../../../../src/lib/publicData/staticEventReleaseCore.ts";
import {
  EVENT_DETAIL_KEY_PATTERN,
  EVENT_INDEX_KEY,
  EVENT_RELEASE_KEY_PATTERN,
  SnapshotBuildError,
  eventDetailKey,
  eventReleaseKey,
  loadEventPayloadSnapshot,
  type SnapshotLoadOptions,
  type SnapshotManifest,
  type SnapshotSource,
} from "./publicDataLoader.ts";
import { snapshotAccessFromEnv } from "./snapshotEnv.ts";
import {
  FIXTURE_EVENTS_INDEX_PAYLOAD,
  FIXTURE_EVENT_DETAIL_PAYLOADS,
  FIXTURE_EVENT_RELEASE_PAYLOADS,
} from "./eventFixtures.ts";

export type EventBuildData = Readonly<{
  source: "snapshot" | "fixture";
  /** null when the index could not be read: the list page shows CURRENT's unavailable notice. */
  index: StaticEventsIndex | null;
  details: ReadonlyMap<string, StaticEventDetail>;
  releases: ReadonlyMap<string, StaticEventRelease>;
}>;

function idsFromManifest(manifest: SnapshotManifest, pattern: RegExp): string[] {
  const blocked = new Set(manifest.blockedKeys);
  const ids: string[] = [];
  for (const key of manifest.allowedKeys) {
    const m = pattern.exec(key);
    if (m && !blocked.has(key)) ids.push(m[1]);
  }
  return ids.sort();
}

function describe(error: unknown): string {
  return error instanceof SnapshotBuildError ? error.code : error instanceof Error ? error.message : "UNKNOWN";
}

export function buildEventDataFromPayloads(input: {
  source: EventBuildData["source"];
  index: unknown | null;
  details: Record<string, unknown>;
  releases: Record<string, unknown>;
}): EventBuildData {
  const index = input.index && typeof input.index === "object"
    ? normalizeStaticEventsIndex(input.index as Parameters<typeof normalizeStaticEventsIndex>[0])
    : null;
  const details = new Map<string, StaticEventDetail>();
  for (const [id, payload] of Object.entries(input.details)) {
    const detail = payload && typeof payload === "object"
      ? normalizeStaticEventDetail(payload as Parameters<typeof normalizeStaticEventDetail>[0])
      : null;
    // The key names the page; the payload must describe the same public event.
    if (detail && detail.event.id === id) details.set(id, detail);
    else console.warn(`[event] no page for ${id}: not a public event detail`);
  }
  const releases = new Map<string, StaticEventRelease>();
  for (const [id, payload] of Object.entries(input.releases)) {
    const release = payload && typeof payload === "object"
      ? normalizeStaticEventRelease(payload as Parameters<typeof normalizeStaticEventRelease>[0])
      : null;
    if (release && release.event.id === id) releases.set(id, release);
    else console.warn(`[event] no release page for ${id}: not a public event release`);
  }
  return { source: input.source, index, details, releases };
}

export async function loadEventBuildData(
  env: Record<string, string | undefined> = process.env,
  injected?: { source: SnapshotSource; manifest: SnapshotManifest; generation: string },
): Promise<EventBuildData> {
  // Fixtures stand in only when NO snapshot variable is set; a partly configured snapshot throws (same as users/listings).
  const access = injected ? null : snapshotAccessFromEnv(env);
  if (!injected && !access) {
    return buildEventDataFromPayloads({
      source: "fixture",
      index: FIXTURE_EVENTS_INDEX_PAYLOAD,
      details: FIXTURE_EVENT_DETAIL_PAYLOADS,
      releases: FIXTURE_EVENT_RELEASE_PAYLOADS,
    });
  }
  const source: SnapshotSource = injected?.source ?? access!.source;
  const options: SnapshotLoadOptions = injected
    ? { manifest: injected.manifest, generation: injected.generation }
    : access!.options;
  const manifest = options.manifest;

  let indexPayload: unknown | null = null;
  try {
    indexPayload = await loadEventPayloadSnapshot(source, EVENT_INDEX_KEY, options);
  } catch (error) {
    console.warn(`[event] index unavailable: ${describe(error)}`);
  }
  const read = async (ids: string[], key: (id: string) => string): Promise<Record<string, unknown>> => {
    const out: Record<string, unknown> = {};
    for (const id of ids) {
      try {
        out[id] = await loadEventPayloadSnapshot(source, key(id), options);
      } catch (error) {
        console.warn(`[event] no page for ${id}: ${describe(error)}`);
      }
    }
    return out;
  };
  return buildEventDataFromPayloads({
    source: "snapshot",
    index: indexPayload,
    details: await read(idsFromManifest(manifest, EVENT_DETAIL_KEY_PATTERN), eventDetailKey),
    releases: await read(idsFromManifest(manifest, EVENT_RELEASE_KEY_PATTERN), eventReleaseKey),
  });
}

let cached: Promise<EventBuildData> | null = null;
/** One load per build process: every event page shares it. */
export function getEventBuildData(): Promise<EventBuildData> {
  cached ??= loadEventBuildData();
  return cached;
}
