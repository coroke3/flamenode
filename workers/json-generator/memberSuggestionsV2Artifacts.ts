import {
  buildMemberSuggestionsV2Artifacts,
  memberSuggestionsV2ArtifactByteLength,
  memberSuggestionsV2DirectoryObjectKey,
  memberSuggestionsV2PageObjectKey,
  normalizeMemberSuggestionsV2Manifest,
  MEMBER_SUGGESTIONS_V2_GENERATION_PREFIX,
  MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
  MEMBER_SUGGESTIONS_V2_MAX_ARTIFACT_BYTES,
} from "../../src/lib/video/memberSuggestionsPostingsV2.ts";
import type { MemberSuggestionItem } from "../../src/lib/video/memberSuggestionsCore.ts";

/**
 * member_suggestions の canonical V1 rebuild と同じ invocation で公開するため、
 * V2 は R2 subrequest を厳格に上限化する。上限を超える世代は V2 manifest を
 * 公開せず、request path は V1 index へ fail-safe する。
 */
const MEMBER_SUGGESTIONS_V2_MAX_PUBLISH_OBJECTS = 20;
const MEMBER_SUGGESTIONS_V2_CLEANUP_LIST_LIMIT = 1000;
const PRIVATE_CACHE_CONTROL = "private, max-age=0, must-revalidate";

type V2Bucket = Pick<R2Bucket, "get" | "put" | "delete" | "list">;

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(
    signal.reason === undefined
      ? "member suggestions v2 rebuild aborted"
      : String(signal.reason),
  );
}

function assertArtifactFits(key: string, value: unknown): void {
  const bytes = memberSuggestionsV2ArtifactByteLength(value);
  if (bytes > MEMBER_SUGGESTIONS_V2_MAX_ARTIFACT_BYTES) {
    throw new Error(
      `member_suggestions_v2_artifact_too_large:${key}:${bytes}`,
    );
  }
}

async function putJson(
  bucket: V2Bucket,
  key: string,
  value: unknown,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: PRIVATE_CACHE_CONTROL,
    },
  });
  throwIfAborted(signal);
}

async function readPreviousGeneration(
  bucket: V2Bucket,
): Promise<string | null> {
  try {
    const object = await bucket.get(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
    if (!object) return null;
    const manifest = normalizeMemberSuggestionsV2Manifest(
      await object.json<unknown>(),
    );
    return manifest?.generation ?? null;
  } catch {
    return null;
  }
}

async function deleteManifestBestEffort(bucket: V2Bucket): Promise<void> {
  try {
    await bucket.delete(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
  } catch {
    // V1 is canonical. A transient cleanup failure is logged by the caller's
    // outcome path, and the next rebuild retries manifest removal first.
  }
}

async function deleteKeysBestEffort(
  bucket: V2Bucket,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  try {
    await bucket.delete([...keys]);
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "member-suggestions-v2",
        result: "orphan_cleanup_failed",
        object_count: keys.length,
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

/**
 * manifest commit後に旧generationをbounded cleanupする。
 * 現行writerは1世代20 object以下に制限しているため通常1 pageで収まるが、
 * 過去の実装/partial objectにも耐えるよう1000件まで削除し、truncatedなら
 * 次回以降に残す。cleanup失敗で新manifestを巻き戻さない。
 */
async function cleanupPreviousGenerationBestEffort(
  bucket: V2Bucket,
  previousGeneration: string | null,
  currentGeneration: string,
): Promise<void> {
  if (!previousGeneration || previousGeneration === currentGeneration) return;
  try {
    const prefix = `${MEMBER_SUGGESTIONS_V2_GENERATION_PREFIX}/${previousGeneration}/`;
    const listed = await bucket.list({
      prefix,
      limit: MEMBER_SUGGESTIONS_V2_CLEANUP_LIST_LIMIT,
    });
    const keys = listed.objects.map((object) => object.key);
    if (keys.length > 0) await bucket.delete(keys);
    if (listed.truncated) {
      console.warn(
        JSON.stringify({
          service: "member-suggestions-v2",
          result: "previous_generation_cleanup_truncated",
          generation: previousGeneration,
          deleted_count: keys.length,
        }),
      );
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "member-suggestions-v2",
        result: "previous_generation_cleanup_failed",
        generation: previousGeneration,
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }
}

/**
 * V2 postings は純粋な高速化成果物。V1 正本の成功を V2 障害で失敗扱いにしない。
 * manifest を唯一の commit point とし、generation-specific object を先に書く。
 */
export async function publishMemberSuggestionsV2BestEffort(args: {
  bucket: V2Bucket;
  items: readonly MemberSuggestionItem[];
  generatedAt: number;
  generation: string;
  signal?: AbortSignal;
}): Promise<{ published: boolean; objectCount: number; reason?: string }> {
  const { bucket, items, generatedAt, generation, signal } = args;
  throwIfAborted(signal);

  const previousGeneration = await readPreviousGeneration(bucket);
  throwIfAborted(signal);

  // 古い V2 を読み続けるより canonical V1 へ戻す方が安全。
  await bucket.delete(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
  throwIfAborted(signal);

  const writtenKeys: string[] = [];
  try {
    const artifacts = buildMemberSuggestionsV2Artifacts({
      items,
      generatedAt,
      generation,
    });
    const entries = [
      ...artifacts.directories.map(({ bucket: bucketId, directory }) => ({
        key: memberSuggestionsV2DirectoryObjectKey(generation, bucketId),
        value: directory,
      })),
      ...artifacts.pages.map(({ bucket: bucketId, page }) => ({
        key: memberSuggestionsV2PageObjectKey(generation, bucketId, page.page),
        value: page,
      })),
    ];
    const objectCount = entries.length + 1;
    if (objectCount > MEMBER_SUGGESTIONS_V2_MAX_PUBLISH_OBJECTS) {
      console.info(
        JSON.stringify({
          service: "member-suggestions-v2",
          result: "v1_fallback_object_budget",
          object_count: objectCount,
          max_objects: MEMBER_SUGGESTIONS_V2_MAX_PUBLISH_OBJECTS,
        }),
      );
      return {
        published: false,
        objectCount,
        reason: "object_budget_exceeded",
      };
    }

    for (const entry of entries) assertArtifactFits(entry.key, entry.value);
    assertArtifactFits(
      MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
      artifacts.manifest,
    );

    for (const entry of entries) {
      await putJson(bucket, entry.key, entry.value, signal);
      writtenKeys.push(entry.key);
    }
    // 唯一の commit point。これより前の generation-specific object は不可視。
    await putJson(
      bucket,
      MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
      artifacts.manifest,
      signal,
    );

    await cleanupPreviousGenerationBestEffort(
      bucket,
      previousGeneration,
      generation,
    );
    return { published: true, objectCount };
  } catch (error) {
    // abortがmanifest PUT直後に発生する境界でも、manifestを先に撤去してから
    // generation objectを消す。逆順だと壊れたmanifestが削除済みobjectを指し得る。
    await deleteManifestBestEffort(bucket);
    await deleteKeysBestEffort(bucket, writtenKeys);
    if (signal?.aborted) throw error;

    console.warn(
      JSON.stringify({
        service: "member-suggestions-v2",
        result: "v1_fallback",
        error_name: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return {
      published: false,
      objectCount: 0,
      reason: error instanceof Error ? error.message : "unknown_error",
    };
  }
}
