import {
  buildPickupCreatorsFromProjection,
  loadPublicCreatorProjectionSources,
  normalizePickupCreatorsArtifact,
  PICKUP_CREATORS_MAX_OBJECT_BYTES,
  PICKUP_CREATORS_OBJECT_KEY,
  type PublicPickupCreatorRow,
} from "../../src/lib/publicData/publicCreatorProjection.ts";
import { readBoundedR2Json } from "../../src/lib/r2Body.ts";

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

type PickupCreatorsDiagnosticReason =
  | "object_too_large"
  | "unsupported_schema_version"
  | "r2_read_failed";

function logPickupCreatorsR2(
  event: PickupCreatorsLoadFailureReason | "corrupt",
  detail: { key: string; reason?: PickupCreatorsDiagnosticReason },
): void {
  try {
    // Diagnostic fields are fixed; never inspect or serialize an R2 Error or
    // an untrusted artifact schema value. A broken logger is best effort.
    console.warn(`[pickupCreatorsR2] ${event}`, detail);
  } catch {
    // A diagnostic sink cannot disable the D1 fallback.
  }
}

export async function loadPickupCreatorsFromR2(
  env: Pick<PickupCreatorsEnv, "R2">,
  signal?: AbortSignal,
): Promise<PickupCreatorsLoadResult> {
  signal?.throwIfAborted();
  try {
    const read = await readBoundedR2Json(
      env.R2,
      PICKUP_CREATORS_OBJECT_KEY,
      PICKUP_CREATORS_MAX_OBJECT_BYTES,
      signal,
    );
    signal?.throwIfAborted();
    if (!read.ok) {
      if (read.reason === "invalid_json") throw read.error;
      if (read.reason === "too_large") {
        logPickupCreatorsR2("corrupt", {
          key: PICKUP_CREATORS_OBJECT_KEY,
          reason: "object_too_large",
        });
        return { ok: false, reason: "corrupt" };
      }
      logPickupCreatorsR2("missing", { key: PICKUP_CREATORS_OBJECT_KEY });
      return { ok: false, reason: "missing" };
    }
    const raw = read.value;

    const schemaVersion = (raw as { schema_version?: unknown })?.schema_version;
    if (
      schemaVersion !== undefined &&
      Number(schemaVersion) !== 1
    ) {
      logPickupCreatorsR2("schema_mismatch", {
        key: PICKUP_CREATORS_OBJECT_KEY,
        reason: "unsupported_schema_version",
      });
      return { ok: false, reason: "schema_mismatch" };
    }

    const artifact = normalizePickupCreatorsArtifact(raw);
    if (!artifact) {
      logPickupCreatorsR2("invalid_creators", { key: PICKUP_CREATORS_OBJECT_KEY });
      return { ok: false, reason: "invalid_creators" };
    }

    return { ok: true, creators: artifact.creators };
  } catch {
    signal?.throwIfAborted();
    logPickupCreatorsR2("get_error", {
      key: PICKUP_CREATORS_OBJECT_KEY,
      reason: "r2_read_failed",
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

  try {
    console.warn(`[${context}] pickup_creators_d1_fallback`, {
      reason: loaded.reason,
      limit,
    });
  } catch {
    // Even a broken logger cannot suppress the canonical D1 projection.
  }
  const now = Math.floor(Date.now() / 1000);
  signal?.throwIfAborted();
  // Pickup cards use registered x_users name/icon only; loading historical
  // video snapshots here adds a full window query whose result is discarded.
  const sources = await loadPublicCreatorProjectionSources(env.DB, now, {
    includeProfileFallback: false,
  });
  signal?.throwIfAborted();
  return buildPickupCreatorsFromProjection(sources, limit);
}
