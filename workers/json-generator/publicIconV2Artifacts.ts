import { readBoundedR2Json } from "../../src/lib/r2Body.ts";
import { assertNoForbiddenPublicKeys } from "./sanitize.ts";
import {
  putJsonArtifact,
  staticArtifactContentHash,
} from "./r2Dedup.ts";
import {
  staticR2CacheControl,
  STATIC_R2_MAX_AGE_SEC,
} from "../shared/staticR2CacheControl.ts";
import {
  normalizePublicXIconMap,
  PUBLIC_X_ICON_MAP_MAX_OBJECT_BYTES,
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
  type PublicXIconV2Manifest,
} from "../../src/lib/publicData/publicIconProjectionV2.ts";

type Env = {
  R2: R2Bucket;
};

const SHARD_METADATA_SCHEMA = "public-icon-v2";
const SHARD_METADATA_SCHEMA_KEY = "flamenode_schema";
const SHARD_METADATA_GENERATION_KEY = "flamenode_generation";
const SHARD_METADATA_SHARD_KEY = "flamenode_shard";

type PublicIconV2DiagnosticResult =
  | "generation_cleanup_failed"
  | "manifest_cleanup_failed"
  | "fallback_manifest_restore_failed";

function warnPublicIconV2Diagnostic(
  result: PublicIconV2DiagnosticResult,
  generation?: string,
): void {
  // R2 exceptions are untrusted, including Error.name getters; diagnostics
  // must not alter manifest safety or replace the original operation result.
  try {
    console.warn(JSON.stringify({
      service: "public-icon-v2",
      result,
      ...(generation === undefined ? {} : { generation }),
    }));
  } catch {
    // Best-effort sink only.
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

async function readCurrentManifest(
  env: Env,
): Promise<ReturnType<typeof normalizePublicXIconV2Manifest>> {
  try {
    const read = await readBoundedR2Json(
      env.R2,
      PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY,
      PUBLIC_X_ICON_V2_MAX_MANIFEST_BYTES,
    );
    return read.ok ? normalizePublicXIconV2Manifest(read.value) : null;
  } catch {
    return null;
  }
}

function expectedShardMetadata(generation: string, shard: number): Record<string, string> {
  return {
    [SHARD_METADATA_SCHEMA_KEY]: SHARD_METADATA_SCHEMA,
    [SHARD_METADATA_GENERATION_KEY]: generation,
    [SHARD_METADATA_SHARD_KEY]: String(shard),
  };
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
      const object = await env.R2.head(
        publicXIconV2ShardObjectKey(generation, shard),
      );
      throwIfAborted(signal);
      if (!object) return false;
      if (
        typeof object.size !== "number" ||
        object.size <= 0 ||
        object.size > PUBLIC_X_ICON_V2_MAX_SHARD_BYTES
      ) {
        return false;
      }
      const metadata = object.customMetadata ?? {};
      const expected = expectedShardMetadata(generation, shard);
      if (
        metadata[SHARD_METADATA_SCHEMA_KEY] !== expected[SHARD_METADATA_SCHEMA_KEY] ||
        metadata[SHARD_METADATA_GENERATION_KEY] !==
          expected[SHARD_METADATA_GENERATION_KEY] ||
        metadata[SHARD_METADATA_SHARD_KEY] !== expected[SHARD_METADATA_SHARD_KEY]
      ) {
        return false;
      }
    } catch {
      throwIfAborted(signal);
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
  } catch {
    warnPublicIconV2Diagnostic("generation_cleanup_failed", generation);
  }
}

async function deleteManifestBestEffort(env: Env): Promise<boolean> {
  try {
    await env.R2.delete(PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY);
    return true;
  } catch {
    warnPublicIconV2Diagnostic("manifest_cleanup_failed");
    return false;
  }
}

async function putManifest(
  env: Env,
  manifest: PublicXIconV2Manifest,
): Promise<void> {
  assertNoForbiddenPublicKeys(manifest);
  if (
    publicXIconV2ArtifactByteLength(manifest) >
    PUBLIC_X_ICON_V2_MAX_MANIFEST_BYTES
  ) {
    throw new Error("public_icon_v2_manifest_too_large");
  }
  await putJsonArtifact(env, PUBLIC_X_ICON_V2_MANIFEST_OBJECT_KEY, manifest, {
    cacheControl: "public, max-age=60, stale-while-revalidate=300",
    schemaVersion: 2,
    deduplicate: false,
  });
}

/**
 * Canonical V1 icon mapから16-shard V2を作る。
 * users_index rebuild後に呼ぶためD1を再読込せず、manifestだけをcommit pointにする。
 *
 * rebuildが必要な場合は、先に同じcanonical generationの空manifestを置く。
 * 空manifestはvalidだがshardを1つも公開しないため、readerはV1へfallbackする。
 * これによりV1更新後のV2失敗/abortで旧V2世代を読み続けることを防ぐ。
 */
export async function rebuildPublicIconV2FromLegacyArtifact(
  env: Env,
  signal?: AbortSignal,
): Promise<{ generation: string; objectCount: number; skipped: boolean }> {
  throwIfAborted(signal);
  const legacyRead = await readBoundedR2Json(
    env.R2,
    PUBLIC_X_ICON_MAP_OBJECT_KEY,
    PUBLIC_X_ICON_MAP_MAX_OBJECT_BYTES,
    signal,
  );
  throwIfAborted(signal);
  if (!legacyRead.ok) {
    throw new Error(
      legacyRead.reason === "missing"
        ? "public_icon_v2_requires_v1_artifact"
        : legacyRead.reason === "too_large"
          ? "public_icon_v2_v1_too_large"
          : "public_icon_v2_v1_invalid_json",
    );
  }
  const legacy = normalizePublicXIconMap(legacyRead.value);
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
    if (
      publicXIconV2ArtifactByteLength(shard) > PUBLIC_X_ICON_V2_MAX_SHARD_BYTES
    ) {
      throw new Error(`public_icon_v2_shard_too_large:${shard.shard}`);
    }
  }

  const previous = await readCurrentManifest(env);
  if (
    previous?.generation === generation &&
    previous.shards.length === artifacts.manifest.shards.length &&
    previous.shards.every(
      (shard, index) => shard === artifacts.manifest.shards[index],
    ) &&
    (await generationIsComplete(
      env,
      generation,
      artifacts.manifest.shards,
      signal,
    ))
  ) {
    return {
      generation,
      objectCount: artifacts.shards.length + 1,
      skipped: true,
    };
  }

  const fallbackManifest: PublicXIconV2Manifest = {
    ...artifacts.manifest,
    shards: [],
  };

  try {
    await putManifest(env, fallbackManifest);
  } catch (error) {
    await deleteManifestBestEffort(env);
    throw error;
  }
  throwIfAborted(signal);

  const writtenKeys: string[] = [];
  try {
    for (const shard of artifacts.shards) {
      throwIfAborted(signal);
      assertNoForbiddenPublicKeys(shard);
      const key = publicXIconV2ShardObjectKey(generation, shard.shard);
      await putJsonArtifact(env, key, shard, {
        cacheControl: staticR2CacheControl(STATIC_R2_MAX_AGE_SEC.usersIndex),
        schemaVersion: 2,
        customMetadata: expectedShardMetadata(generation, shard.shard),
        deduplicate: false,
      });
      writtenKeys.push(key);
    }

    throwIfAborted(signal);
    await putManifest(env, artifacts.manifest);
  } catch (error) {
    let manifestSafeForShardCleanup = false;
    try {
      await putManifest(env, fallbackManifest);
      manifestSafeForShardCleanup = true;
    } catch {
      warnPublicIconV2Diagnostic("fallback_manifest_restore_failed", generation);
      manifestSafeForShardCleanup = await deleteManifestBestEffort(env);
    }

    if (manifestSafeForShardCleanup && writtenKeys.length > 0) {
      try {
        await env.R2.delete(writtenKeys);
      } catch {
        // fallback manifest / manifest撤去後は到達不能なimmutable orphanなので安全。
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
