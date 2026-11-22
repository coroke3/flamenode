/**
 * MIG-0666 U01/U02: build-only, injected-bucket publisher for CURRENT public
 * event API JSON. Never creates credentials, clients or production bindings.
 */
import { createHash } from "node:crypto";
import { EVENT_INDEX_KEY, eventDetailKey, eventReleaseKey } from "../src/lib/publicDataLoader.ts";
import { eventReleaseObjectKey } from "../../../src/lib/publicData/staticEventDetailCore.ts";
import type { ProduceResult, ProducedSnapshot } from "./produceSnapshots.ts";

const RELEASE_SOURCE_PATTERN = /^snapshot\/event-release\/([A-Za-z0-9_-]{1,128})\.json$/;
const EVENT_DETAIL_SOURCE_PATTERN = /^snapshot\/event-detail\/([A-Za-z0-9_-]{1,128})\.json$/;
const MAX_API_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_API_RELEASE_OBJECTS = 5000;
// CURRENT rebuildEventsIndex selects the latest 200 non-point public events.
const MAX_EVENT_INDEX_ROWS = 200;
// Same path-safe legacy ID set as the build producer (leading _/- valid).
const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_READBACK_RETRIES = 3;

export interface ApiArtifactBucket {
  get(key: string): Promise<{ text(): Promise<string>; size?: number } | null>;
  put(key: string, body: string): Promise<unknown>;
}

export interface ApiArtifactToPublish {
  key: string;
  body: string;
  sha256: string;
}

export interface ApiArtifactPublishReport {
  artifacts: number;
  puts: number;
  skipped: number;
  retries: number;
  verified: number;
  bytes: number;
}

function digest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * Extract only manifest-authorized build artifacts. Snapshots are envelopes
 * for Astro SSG, while the CURRENT API R2 objects have bare JSON payloads.
 * Publishing an envelope instead would silently break the Hono readers.
 */
export function selectApiArtifacts(result: Pick<ProduceResult, "snapshots" | "manifest">): ApiArtifactToPublish[] {
  const allowed = new Set(result.manifest.allowedKeys);
  const blocked = new Set(result.manifest.blockedKeys);
  if (allowed.size !== result.manifest.allowedKeys.length ||
      result.manifest.schemaVersion !== 1) {
    throw new Error("api artifact publish: invalid or duplicate manifest entries");
  }
  const sources = new Map<string, ProducedSnapshot>();
  for (const snapshot of result.snapshots) {
    if (sources.has(snapshot.key)) throw new Error("api artifact publish: duplicate snapshot key");
    sources.set(snapshot.key, snapshot);
  }
  const detailIds = new Set<string>();
  const releaseIds = new Set<string>();
  for (const key of allowed) {
    const detail = EVENT_DETAIL_SOURCE_PATTERN.exec(key);
    if (detail) detailIds.add(detail[1]!);
    const release = RELEASE_SOURCE_PATTERN.exec(key);
    if (release) releaseIds.add(release[1]!);
  }
  if (releaseIds.size > MAX_API_RELEASE_OBJECTS ||
      detailIds.size !== releaseIds.size ||
      [...detailIds].some((id) => !releaseIds.has(id) ||
        !allowed.has(eventDetailKey(id)) || !allowed.has(eventReleaseKey(id)))) {
    throw new Error("api artifact publish: incomplete event release coverage");
  }
  // A failed release PUT/readback must never promote an index pointing at it.
  // This is index-last ordering, not an atomic cross-key transaction: existing
  // readers can still see a changed release before index promotion.
  const sourceKeys = [...[...releaseIds].sort().map(eventReleaseKey), EVENT_INDEX_KEY];
  const artifacts = sourceKeys.map((sourceKey) => {
    if (!allowed.has(sourceKey) || blocked.has(sourceKey)) {
      throw new Error("api artifact publish: event artifact is not allowed by build manifest");
    }
    const snapshot = sources.get(sourceKey);
    if (!snapshot) throw new Error("api artifact publish: manifest-listed snapshot missing");
    let envelope: any;
    try { envelope = JSON.parse(snapshot.json); }
    catch { throw new Error("api artifact publish: invalid snapshot envelope"); }
    if (!envelope || envelope.schemaVersion !== 1 ||
        envelope.generation !== result.manifest.generation ||
        envelope.key !== sourceKey || envelope.visibility !== "public") {
      throw new Error("api artifact publish: snapshot identity or visibility mismatch");
    }
    const body = JSON.stringify(envelope.payload);
    if (typeof body !== "string" || !body || Buffer.byteLength(body, "utf8") > MAX_API_ARTIFACT_BYTES ||
        digest(body) !== snapshot.sha256 || digest(body) !== envelope.sha256) {
      throw new Error("api artifact publish: payload digest or byte budget mismatch");
    }
    const match = RELEASE_SOURCE_PATTERN.exec(sourceKey);
    const key = match ? eventReleaseObjectKey(match[1]!) : "events/index.json";
    return { key, body, sha256: digest(body) };
  });
  // The manifest alone cannot expose an event whose detail AND release
  // both failed to build. Compare against the CURRENT events/index.json
  // items, which were generated from the public event IDs for this build.
  let eventIndex: unknown;
  try { eventIndex = JSON.parse(artifacts[artifacts.length - 1]!.body); }
  catch { throw new Error("api artifact publish: event index JSON is invalid"); }
  const items = eventIndex && typeof eventIndex === "object" &&
    !Array.isArray(eventIndex) ? (eventIndex as { items?: unknown }).items : undefined;
  if (!Array.isArray(items) || items.length > MAX_EVENT_INDEX_ROWS) {
    throw new Error("api artifact publish: event index items are invalid or over budget");
  }
  const indexIds = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("api artifact publish: invalid event index entry");
    }
    const row = item as { id?: unknown; visibility_status?: unknown };
    if (typeof row.id !== "string" || !EVENT_ID_PATTERN.test(row.id) ||
        (row.visibility_status !== undefined && row.visibility_status !== "public") ||
        indexIds.has(row.id)) {
      throw new Error("api artifact publish: invalid, duplicate or nonpublic event index entry");
    }
    indexIds.add(row.id);
  }
  // CURRENT index filters point/half-bounded events and caps rows at 200,
  // while the build creates releases for every public event. Extra releases
  // are valid; every index entry must still have a verified release.
  if ([...indexIds].some((id) => !releaseIds.has(id))) {
    throw new Error("api artifact publish: event index / release set mismatch");
  }
  return artifacts;
}

async function readExisting(bucket: ApiArtifactBucket, target: ApiArtifactToPublish): Promise<boolean> {
  const object = await bucket.get(target.key);
  if (!object) return false;
  if (object.size !== undefined &&
      (!Number.isSafeInteger(object.size) || object.size < 0 || object.size > MAX_API_ARTIFACT_BYTES)) {
    throw new Error("api artifact publish: remote object exceeds comparison budget");
  }
  const body = await object.text();
  if (Buffer.byteLength(body, "utf8") > MAX_API_ARTIFACT_BYTES) {
    throw new Error("api artifact publish: remote object exceeds comparison budget");
  }
  return digest(body) === target.sha256;
}

/**
 * Initial PUT + at most three verification-driven retry PUTs. A failed readback
 * does not become a successful build, and an unchanged object is never PUT.
 */
export async function publishApiArtifacts(
  result: Pick<ProduceResult, "snapshots" | "manifest">,
  bucket: ApiArtifactBucket,
): Promise<ApiArtifactPublishReport> {
  const artifacts = selectApiArtifacts(result);
  const report: ApiArtifactPublishReport = {
    artifacts: artifacts.length, puts: 0, skipped: 0, retries: 0,
    verified: 0, bytes: 0,
  };
  for (const target of artifacts) {
    report.bytes += Buffer.byteLength(target.body, "utf8");
    if (await readExisting(bucket, target)) {
      report.skipped += 1;
      report.verified += 1;
      continue;
    }
    let verified = false;
    for (let attempt = 0; attempt <= MAX_READBACK_RETRIES; attempt++) {
      await bucket.put(target.key, target.body);
      report.puts += 1;
      if (attempt > 0) report.retries += 1;
      if (await readExisting(bucket, target)) {
        verified = true;
        report.verified += 1;
        break;
      }
    }
    if (!verified) {
      throw new Error("api artifact publish: readback integrity failed after 3 retries");
    }
  }
  return report;
}
