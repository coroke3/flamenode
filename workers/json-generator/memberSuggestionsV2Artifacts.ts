import {
  buildMemberSuggestionsV2Artifacts,
  memberSuggestionsV2ArtifactByteLength,
  memberSuggestionsV2DirectoryObjectKey,
  memberSuggestionsV2PageObjectKey,
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
const PRIVATE_CACHE_CONTROL = "private, max-age=0, must-revalidate";

type V2Bucket = Pick<R2Bucket, "put" | "delete">;

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

  // 古い V2 を読み続けるより canonical V1 へ戻す方が安全。
  await bucket.delete(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
  throwIfAborted(signal);

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
    }
    // 唯一の commit point。これより前の generation-specific object は不可視。
    await putJson(
      bucket,
      MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
      artifacts.manifest,
      signal,
    );

    return { published: true, objectCount };
  } catch (error) {
    if (signal?.aborted) throw error;
    try {
      await bucket.delete(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
    } catch {
      // V1 remains canonical even if this best-effort cleanup itself fails.
    }
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
