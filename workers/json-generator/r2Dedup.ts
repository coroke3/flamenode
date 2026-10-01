type DedupEnv = {
  DB: D1Database;
  R2: R2Bucket;
  artifactHashCache?: ArtifactHashCache;
};

export type JsonArtifactPutResolution = {
  object: R2Object;
  contentHash: string;
  /** false for a legacy object so the next write upgrades it with hash metadata. */
  skipPut: boolean;
};

const MAX_PRELOAD_ARTIFACT_HASHES = 100;

export class ArtifactHashCache {
  private readonly hashes = new Map<string, string | null>();
  private readonly loadedTargets = new Set<string>();

  async preload(
    db: D1Database,
    targetType: string,
    targetId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const targetKey = `${targetType}:${targetId}`;
    if (this.loadedTargets.has(targetKey)) return;
    signal?.throwIfAborted();

    const result = await db
      .prepare(
        `SELECT object_key, content_hash
         FROM static_artifacts
         WHERE target_type = ?
           AND target_id = ?
           AND deleted_at IS NULL
         LIMIT ?`,
      )
      .bind(targetType, targetId, MAX_PRELOAD_ARTIFACT_HASHES)
      .all<{ object_key: string; content_hash?: string | null }>();

    signal?.throwIfAborted();
    for (const row of result.results ?? []) {
      this.hashes.set(row.object_key, row.content_hash ?? null);
    }
    this.loadedTargets.add(targetKey);
  }

  get(objectKey: string): string | null | undefined {
    if (!this.hashes.has(objectKey)) return undefined;
    return this.hashes.get(objectKey) ?? null;
  }

  set(objectKey: string, hash: string | null): void {
    this.hashes.set(objectKey, hash);
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function meaningfulJsonBody(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const { generated_at: _generatedAt, ...meaningful } = parsed as Record<
        string,
        unknown
      >;
      return JSON.stringify(meaningful);
    }
  } catch {
    // JSONでない文字列はbytes相当の元文字列をhash対象にする。
  }
  return value;
}

/** 最上位generated_atだけを除外し、公開内容が同一なら同じhashを返す。 */
export async function staticArtifactContentHash(value: string): Promise<string> {
  return sha256Hex(meaningfulJsonBody(value));
}

/** R2 metadata is a fast dedupe hint; static_artifacts remains the tracking source. */
export function staticArtifactCustomMetadata(
  serialized: string,
  contentHash: string,
  defaultSchemaVersion = 1,
): Record<string, string> {
  let schemaVersion = String(defaultSchemaVersion);
  let sourceGeneration = contentHash;
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const row = parsed as Record<string, unknown>;
      const rawSchema = row.schema_version;
      if (
        (typeof rawSchema === "string" || typeof rawSchema === "number") &&
        String(rawSchema).trim()
      ) {
        schemaVersion = String(rawSchema).trim().slice(0, 32);
      }
      const rawGeneration =
        row.source_generation ?? row.generation ?? row.generation_key;
      if (
        (typeof rawGeneration === "string" ||
          typeof rawGeneration === "number") &&
        String(rawGeneration).trim()
      ) {
        const normalized = String(rawGeneration).trim();
        if (normalized.length <= 128) sourceGeneration = normalized;
      }
    }
  } catch {
    // Non-JSON string bodies retain a deterministic content-based generation.
  }
  return {
    content_hash: contentHash,
    schema_version: schemaVersion,
    source_generation: sourceGeneration,
  };
}

/** R2 metadata is checked first; legacy objects use D1 once and are rewritten with metadata. */
export async function resolveIdenticalJsonArtifactPut(
  env: DedupEnv,
  objectKey: string,
  serialized: string,
  knownContentHash?: string,
): Promise<JsonArtifactPutResolution | null> {
  const nextHash = knownContentHash ?? await staticArtifactContentHash(serialized);
  const object = await env.R2.head(objectKey);
  if (!object) return null;

  const metadataHash = object.customMetadata?.content_hash;
  if (metadataHash) {
    return metadataHash === nextHash
      ? { object, contentHash: nextHash, skipPut: true }
      : null;
  }

  const storedHash = await currentArtifactHash(
    env.DB,
    objectKey,
    env.artifactHashCache,
  );
  // Rewriting even a matching legacy object upgrades its metadata, avoiding a
  // permanent D1 lookup on every future rebuild. The comparison also preserves
  // the tracking-table fallback contract for pre-metadata objects.
  return storedHash === nextHash
    ? { object, contentHash: nextHash, skipPut: false }
    : null;
}

async function currentArtifactHash(
  db: D1Database,
  objectKey: string,
  cache?: ArtifactHashCache,
): Promise<string | null> {
  const cached = cache?.get(objectKey);
  if (cached !== undefined) return cached;

  const row = await db
    .prepare(
      `SELECT content_hash
       FROM static_artifacts
       WHERE object_key = ? AND deleted_at IS NULL
       ORDER BY generated_at DESC
       LIMIT 1`,
    )
    .bind(objectKey)
    .first<{ content_hash?: string }>();
  const hash = row?.content_hash ?? null;
  cache?.set(objectKey, hash);
  return hash;
}
