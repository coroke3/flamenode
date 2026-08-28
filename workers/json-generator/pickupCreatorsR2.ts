import {
  buildPickupCreatorsFromProjection,
  loadPublicCreatorProjectionSources,
  normalizePickupCreatorsArtifact,
  PICKUP_CREATORS_MAX_OBJECT_BYTES,
  PICKUP_CREATORS_OBJECT_KEY,
  type PublicPickupCreatorRow,
} from "../../src/lib/publicData/publicCreatorProjection.ts";
import { cancelR2BodyBestEffort } from "../../src/lib/r2Body.ts";

export type PickupCreatorsLoadFailureReason =
  | "missing"
  | "corrupt"
  | "schema_mismatch"
  | "invalid_creators"
  | "get_error";

export type PickupCreatorsLoadResult =
  | { ok: true; creators: PublicPickupCreatorRow[] }
  | { ok: false; reason: PickupCreatorsLoadFailureReason };

type PickupCreatorsEnv = {
  R2: R2Bucket;
  DB: D1Database;
};

function logPickupCreatorsR2(
  event: string,
  detail: Record<string, unknown>,
): void {
  console.warn(`[pickupCreatorsR2] ${event}`, detail);
}

export async function loadPickupCreatorsFromR2(
  env: Pick<PickupCreatorsEnv, "R2">,
  signal?: AbortSignal,
): Promise<PickupCreatorsLoadResult> {
  signal?.throwIfAborted();
  try {
    const object = await env.R2.get(PICKUP_CREATORS_OBJECT_KEY);
    signal?.throwIfAborted();
    if (!object) {
      logPickupCreatorsR2("missing", { key: PICKUP_CREATORS_OBJECT_KEY });
      return { ok: false, reason: "missing" };
    }
    if (
      typeof object.size === "number" &&
      (!Number.isFinite(object.size) ||
        object.size < 0 ||
        object.size > PICKUP_CREATORS_MAX_OBJECT_BYTES)
    ) {
      await cancelR2BodyBestEffort(object);
      logPickupCreatorsR2("corrupt", {
        key: PICKUP_CREATORS_OBJECT_KEY,
        reason: "object_too_large",
      });
      return { ok: false, reason: "corrupt" };
    }

    const raw = await object.json();
    signal?.throwIfAborted();

    const schemaVersion = (raw as { schema_version?: unknown })?.schema_version;
    if (
      schemaVersion !== undefined &&
      Number(schemaVersion) !== 1
    ) {
      logPickupCreatorsR2("schema_mismatch", {
        key: PICKUP_CREATORS_OBJECT_KEY,
        schema_version: schemaVersion,
      });
      return { ok: false, reason: "schema_mismatch" };
    }

    const artifact = normalizePickupCreatorsArtifact(raw);
    if (!artifact) {
      logPickupCreatorsR2("invalid_creators", { key: PICKUP_CREATORS_OBJECT_KEY });
      return { ok: false, reason: "invalid_creators" };
    }

    return { ok: true, creators: artifact.creators };
  } catch (error) {
    logPickupCreatorsR2("get_error", {
      key: PICKUP_CREATORS_OBJECT_KEY,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "get_error" };
  }
}

export async function resolvePickupCreatorsWithFallback(
  env: PickupCreatorsEnv,
  limit: number,
  context: string,
  signal?: AbortSignal,
): Promise<PublicPickupCreatorRow[]> {
  const loaded = await loadPickupCreatorsFromR2(env, signal);
  if (loaded.ok) {
    return loaded.creators.slice(0, Math.max(0, limit));
  }

  console.warn(`[${context}] pickup_creators_d1_fallback`, {
    reason: loaded.reason,
    limit,
  });
  const now = Math.floor(Date.now() / 1000);
  const sources = await loadPublicCreatorProjectionSources(env.DB, now);
  signal?.throwIfAborted();
  return buildPickupCreatorsFromProjection(sources, limit);
}
