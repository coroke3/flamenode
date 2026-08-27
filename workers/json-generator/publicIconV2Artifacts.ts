import { assertNoForbiddenPublicKeys } from "./sanitize.ts";
import { staticArtifactContentHash } from "./r2Dedup.ts";
import {
  staticR2CacheControl,
  STATIC_R2_MAX_AGE_SEC,
} from "../shared/staticR2CacheControl.ts";
import {
  normalizePublicXIconMap,
  PUBLIC_X_ICON_MAP_OBJECT_KEY,
} from "../../src/lib/publicData/publicIconProjection.ts";
import {
  buildPublicXIconV2Artifacts,
  normalizePublicXIconV2Manifest,
  PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY,
  PUBLIC_X_ICON_V2_MAX_MANIFEST_BYTES,
  PUBLIC_X_ICON_V2_MAX_SHARD_BYTES,
  publicXIconV2ArtifactByteLength,
  publicXIconV2GenerationMaterial,
  publicXIconV2ShardObjectKey,
} from "../../src/lib/publicData/publicIconProjectionV2.ts";

type Env = {
  R2: R2Bucket;
};

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

async function readCurrentManifest(env: Env): Promise<ReturnType<typeof normalizePublicXIconV2Manifest>> {
  try {
    const object = await env.R2.get(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY);
    if (!object) return null;
    return normalizePublicXIconV2Manifest(await object.json());
  } catch {
    return null;
  }
}

async function generationIsComplete(
  env: Env,
  generation: string,
  shards: readonly number[],
  signal?: AbortSignal,
): Promise<boolean> {
  for (const shard of shards) {
    throwIfAborted(signal);
    try {
      if (!(await env.R2.head(publicXIconV2ShardObjectKey(generation, shard)))) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function deleteGenerationBestEffort(
  env: Env,
  generation: string,
  shards: readonly number[],
): Promise<void> {
  const keys = shards.map((shard) =>
    publicXIconV2ShardObjectKey(generation, shard),
  );
  if (keys.length === 0) return;
  try {
    await env.R2.delete(keys);
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "public-icon-v2",
        result: "generation_cleanup_failed",
        generation,
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

/**
 * Canonical V1 icon mapから16-shard V2を作る。
 * users_index rebuild後に呼ぶためD1を再読込せず、manifestだけをcommit pointにする。
 */
export async function rebuildPublicIconV2FromLegacyArtifact(
  env: Env,
  signal?: AbortSignal,
): Promise<{ generation: string; objectCount: number; skipped: boolean }> {
  throwIfAborted(signal);
  const legacyObject = await env.R2.get(PUBLIC_X_ICON_MAP_OBJECT_KEY);
  throwIfAborted(signal);
  if (!legacyObject) throw new Error("public_icon_v2_requires_v1_artifact");

  let legacyPayload: unknown;
  try {
    legacyPayload = await legacyObject.json();
  } catch {
    throw new Error("public_icon_v2_v1_invalid_json");
  }
  const legacy = normalizePublicXIconMap(legacyPayload);
  if (!legacy) throw new Error("public_icon_v2_v1_invalid");

  const generation = await staticArtifactContentHash(
    publicXIconV2GenerationMaterial(legacy),
  );
  throwIfAborted(signal);
  const artifacts = buildPublicXIconV2Artifacts({ payload: legacy, generation });

  if (
    publicXIconV2ArtifactByteLength(artifacts.manifest) >
    PUBLIC_X_ICON_V2_MAX_MANIFEST_BYTES
  ) {
    throw new Error("public_icon_v2_manifest_too_large");
  }
  for (const shard of artifacts.shards) {
    if (publicXIconV2ArtifactByteLength(shard) > PUBLIC_X_ICON_V2_MAX_SHARD_BYTES) {
      throw new Error(`public_icon_v2_shard_too_large:${shard.shard}`);
    }
  }

  const previous = await readCurrentManifest(env);
  if (
    previous?.generation === generation &&
    previous.shards.length === artifacts.manifest.shards.length &&
    previous.shards.every((shard, index) => shard === artifacts.manifest.shards[index]) &&
    (await generationIsComplete(env, generation, artifacts.manifest.shards, signal))
  ) {
    return {
      generation,
      objectCount: artifacts.shards.length + 1,
      skipped: true,
    };
  }

  const writtenKeys: string[] = [];
  try {
    for (const shard of artifacts.shards) {
      throwIfAborted(signal);
      assertNoForbiddenPublicKeys(shard);
      const key = publicXIconV2ShardObjectKey(generation, shard.shard);
      await env.R2.put(key, JSON.stringify(shard), {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.usersIndex),
        },
      });
      writtenKeys.push(key);
    }

    throwIfAborted(signal);
    assertNoForbiddenPublicKeys(artifacts.manifest);
    await env.R2.put(
      PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY,
      JSON.stringify(artifacts.manifest),
      {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "public, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    // 新世代はmanifest未commitなら読取側から到達不能。旧世代と異なる時だけ
    // best-effort cleanupし、旧manifestを壊さない。
    if (previous?.generation !== generation && writtenKeys.length > 0) {
      try {
        await env.R2.delete(writtenKeys);
      } catch {
        // orphan immutable shardは安全。次回generation cleanupへ任せる。
      }
    }
    throw error;
  }

  if (previous && previous.generation !== generation) {
    await deleteGenerationBestEffort(env, previous.generation, previous.shards);
  }

  return {
    generation,
    objectCount: artifacts.shards.length + 1,
    skipped: false,
  };
}
