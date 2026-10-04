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

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // JSONでない文字列はbytes相当の元文字列をhash対象にする。
  }
  return null;
}

/**
 * `JSON.stringify(row)` が最上位 generated_at（数値・文字列）で始まるとき、
 * その項目を除いた直列化を文字列の切り出しで返す。残りの項目は同じ順序・同じ
 * 値で直列化されるので `JSON.stringify(rest)` と一致する。合わなければ null。
 */
function sliceLeadingGeneratedAt(
  row: Record<string, unknown>,
  serializedRow: string,
): string | null {
  const value = row.generated_at;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (Object.keys(row)[0] !== "generated_at") return null;
  const prefix = `{"generated_at":${JSON.stringify(value)}`;
  if (!serializedRow.startsWith(prefix)) return null;
  if (serializedRow.length === prefix.length + 1) return "{}";
  if (serializedRow[prefix.length] !== ",") return null;
  return `{${serializedRow.slice(prefix.length + 1)}`;
}

/** 最上位generated_atを除いた直列化。row自身の直列化を渡すと再直列化を省ける。 */
function meaningfulJsonText(
  row: Record<string, unknown>,
  serializedRow?: string,
): string {
  if (Object.hasOwn(row, "generated_at")) {
    const sliced =
      serializedRow === undefined
        ? null
        : sliceLeadingGeneratedAt(row, serializedRow);
    if (sliced !== null) return sliced;
    const { generated_at: _generatedAt, ...meaningful } = row;
    return JSON.stringify(meaningful);
  }
  return serializedRow ?? JSON.stringify(row);
}

/** 最上位generated_atだけを除外し、公開内容が同一なら同じhashを返す。 */
export async function staticArtifactContentHash(value: string): Promise<string> {
  const row = parseJsonObject(value);
  return sha256Hex(row ? meaningfulJsonText(row) : value);
}

function metadataScalar(value: unknown): string | null {
  return (typeof value === "string" || typeof value === "number") &&
    String(value).trim()
    ? String(value).trim()
    : null;
}

function customMetadataFromRow(
  row: Record<string, unknown> | null,
  contentHash: string,
  defaultSchemaVersion: number,
): Record<string, string> {
  const schemaVersion = metadataScalar(row?.schema_version);
  const generation = metadataScalar(
    row?.source_generation ?? row?.generation ?? row?.generation_key,
  );
  return {
    content_hash: contentHash,
    schema_version: schemaVersion?.slice(0, 32) ?? String(defaultSchemaVersion),
    source_generation:
      generation !== null && generation.length <= 128 ? generation : contentHash,
  };
}

/** R2 metadata is a fast dedupe hint; static_artifacts remains the tracking source. */
export function staticArtifactCustomMetadata(
  serialized: string,
  contentHash: string,
  defaultSchemaVersion = 1,
): Record<string, string> {
  return customMetadataFromRow(
    parseJsonObject(serialized),
    contentHash,
    defaultSchemaVersion,
  );
}

export type SerializedJsonArtifact = {
  serialized: string;
  contentHash: string;
  customMetadata: Record<string, string>;
};

/**
 * Plain object body の最上位値を JSON round-trip 後と同じ形で返す。
 * object値は toJSON 等で round-trip 結果が変わりうるため null（再parse）にする。
 */
function topLevelJsonView(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const proto = Object.getPrototypeOf(body);
  if (proto !== Object.prototype && proto !== null) return null;
  const row = body as Record<string, unknown>;
  if (typeof row.toJSON === "function") return null;
  const view: Record<string, unknown> = {};
  for (const key of [
    "generated_at",
    "schema_version",
    "source_generation",
    "generation",
    "generation_key",
  ]) {
    if (!Object.hasOwn(row, key)) continue;
    const value = row[key];
    if (value !== null && (typeof value === "object" || typeof value === "bigint")) {
      return null;
    }
    if (typeof value === "number") {
      view[key] = Number.isFinite(value) ? value : null;
    } else if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      value === null
    ) {
      view[key] = value;
    }
  }
  return view;
}

/**
 * 公開JSON artifactを1回だけ直列化し、content hashとR2 metadataを返す。
 * staticArtifactContentHash / staticArtifactCustomMetadata(JSON.stringify(body)) と同値で、
 * plain object では直列化済み文字列の再parseを省く。
 */
/**
 * `staticArtifactContentHash(JSON.stringify(body))` と同値。plain object では
 * 直列化した文字列の再parse・再直列化を省く（5,000行の生成素材で各10ms前後）。
 */
export async function jsonContentHash(body: unknown): Promise<string> {
  const serialized = JSON.stringify(body);
  return topLevelJsonView(body)
    ? sha256Hex(meaningfulJsonText(body as Record<string, unknown>, serialized))
    : staticArtifactContentHash(serialized);
}

export async function serializeJsonArtifact(
  body: unknown,
  defaultSchemaVersion = 1,
): Promise<SerializedJsonArtifact> {
  const serialized = JSON.stringify(body);
  const view = topLevelJsonView(body);
  if (!view) {
    const contentHash = await staticArtifactContentHash(serialized);
    return {
      serialized,
      contentHash,
      customMetadata: staticArtifactCustomMetadata(
        serialized,
        contentHash,
        defaultSchemaVersion,
      ),
    };
  }
  const contentHash = await sha256Hex(
    meaningfulJsonText(body as Record<string, unknown>, serialized),
  );
  return {
    serialized,
    contentHash,
    customMetadata: customMetadataFromRow(view, contentHash, defaultSchemaVersion),
  };
}

type JsonArtifactPutOptions = {
  cacheControl: string;
  schemaVersion?: number;
  /** Written under the artifact's own content-hash metadata. */
  customMetadata?: Record<string, string>;
};

/**
 * Serialize `body` and PUT it as a JSON artifact. With `deduplicate`, an
 * object whose stored content hash already matches is not rewritten.
 */
export async function putJsonArtifact(
  env: DedupEnv,
  key: string,
  body: unknown,
  options: JsonArtifactPutOptions & { deduplicate: boolean },
): Promise<SerializedJsonArtifact & { wrote: boolean }>;
export async function putJsonArtifact(
  env: { R2: Pick<R2Bucket, "put"> },
  key: string,
  body: unknown,
  options: JsonArtifactPutOptions & { deduplicate: false },
): Promise<SerializedJsonArtifact & { wrote: boolean }>;
export async function putJsonArtifact(
  env: DedupEnv | { R2: Pick<R2Bucket, "put"> },
  key: string,
  body: unknown,
  options: JsonArtifactPutOptions & { deduplicate: boolean },
): Promise<SerializedJsonArtifact & { wrote: boolean }> {
  const artifact = await serializeJsonArtifact(body, options.schemaVersion);
  const identical = options.deduplicate
    ? await resolveIdenticalJsonArtifactPut(
        env as DedupEnv,
        key,
        artifact.serialized,
        artifact.contentHash,
      )
    : null;
  if (identical?.skipPut) return { ...artifact, wrote: false };
  await env.R2.put(key, artifact.serialized, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: options.cacheControl,
    },
    customMetadata: { ...options.customMetadata, ...artifact.customMetadata },
  });
  return { ...artifact, wrote: true };
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
